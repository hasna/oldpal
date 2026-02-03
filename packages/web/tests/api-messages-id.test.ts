import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock state
let mockMessage: any = null;
let mockUserAgents: any[] = [];
let mockRecipientAgent: any = null;
let mockUpdatedMessage: any = null;
let updateSetData: any = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      agentMessages: {
        findFirst: async () => mockMessage,
      },
      agents: {
        findMany: async () => mockUserAgents,
        findFirst: async () => mockRecipientAgent,
      },
    },
    update: (table: any) => ({
      set: (data: any) => {
        updateSetData = data;
        return {
          where: (condition: any) => ({
            returning: () => [mockUpdatedMessage || { ...mockMessage, ...data }],
          }),
        };
      },
    }),
  },
}));

// Mock db schema
mock.module('@/db/schema', () => ({
  agentMessages: 'agentMessages',
  agents: 'agents',
}));

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => ({
  withAuth: (handler: any) => async (req: any, context: any) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 }
      );
    }
    const token = authHeader.substring(7);
    if (token === 'invalid') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }
    (req as any).user = { userId: 'user-123', email: 'test@example.com', role: 'user' };
    return handler(req, context);
  },
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => ({
  eq: (field: any, value: any) => ({ field, value }),
  or: (...args: any[]) => ({ or: args }),
}));

const { GET, PATCH } = await import('../src/app/api/v1/messages/[id]/route');

function createGetRequest(
  messageId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/messages/${messageId}`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { headers });
  const context = { params: { id: messageId } };

  return [request, context];
}

function createPatchRequest(
  messageId: string,
  body: Record<string, unknown>,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/messages/${messageId}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  const context = { params: { id: messageId } };

  return [request, context];
}

describe('GET /api/v1/messages/:id', () => {
  beforeEach(() => {
    mockMessage = {
      id: 'msg-123',
      fromAgentId: 'agent-1',
      toAgentId: 'agent-2',
      subject: 'Test message',
      content: 'Hello',
      status: 'unread',
    };
    mockUserAgents = [{ id: 'agent-1' }, { id: 'agent-2' }];
    mockRecipientAgent = null;
    mockUpdatedMessage = null;
    updateSetData = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/messages/msg-123');
      const request = new NextRequest(url);
      const context = { params: { id: 'msg-123' } };

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const [request, context] = createGetRequest('msg-123', { token: 'invalid' });

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('message retrieval', () => {
    test('returns message when user owns sender agent', async () => {
      mockMessage = {
        id: 'msg-123',
        fromAgentId: 'agent-1',
        toAgentId: 'agent-other',
        content: 'Hello',
      };
      mockUserAgents = [{ id: 'agent-1' }];

      const [request, context] = createGetRequest('msg-123');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('msg-123');
    });

    test('returns message when user owns recipient agent', async () => {
      mockMessage = {
        id: 'msg-123',
        fromAgentId: 'agent-other',
        toAgentId: 'agent-2',
        content: 'Hello',
      };
      mockUserAgents = [{ id: 'agent-2' }];

      const [request, context] = createGetRequest('msg-123');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.id).toBe('msg-123');
    });

    test('returns 404 when message not found', async () => {
      mockMessage = null;
      const [request, context] = createGetRequest('nonexistent');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when user has no access to message', async () => {
      mockMessage = {
        id: 'msg-123',
        fromAgentId: 'agent-other-1',
        toAgentId: 'agent-other-2',
        content: 'Hello',
      };
      mockUserAgents = [{ id: 'agent-mine' }]; // User has different agents

      const [request, context] = createGetRequest('msg-123');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });
});

describe('PATCH /api/v1/messages/:id', () => {
  beforeEach(() => {
    mockMessage = {
      id: 'msg-123',
      fromAgentId: 'agent-1',
      toAgentId: 'agent-2',
      subject: 'Test message',
      content: 'Hello',
      status: 'unread',
      readAt: null,
      injectedAt: null,
    };
    mockUserAgents = [{ id: 'agent-1' }, { id: 'agent-2' }];
    mockRecipientAgent = { id: 'agent-2', userId: 'user-123' };
    mockUpdatedMessage = null;
    updateSetData = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/messages/msg-123');
      const request = new NextRequest(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      });
      const context = { params: { id: 'msg-123' } };

      const response = await PATCH(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('status updates', () => {
    test('updates status to read', async () => {
      const [request, context] = createPatchRequest('msg-123', { status: 'read' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(updateSetData.status).toBe('read');
    });

    test('sets readAt when marking as read', async () => {
      const [request, context] = createPatchRequest('msg-123', { status: 'read' });

      await PATCH(request, context);

      expect(updateSetData.readAt).toBeInstanceOf(Date);
    });

    test('does not update readAt if already set', async () => {
      mockMessage.readAt = new Date('2024-01-01');
      const [request, context] = createPatchRequest('msg-123', { status: 'read' });

      await PATCH(request, context);

      expect(updateSetData.readAt).toBeUndefined();
    });

    test('updates status to archived', async () => {
      const [request, context] = createPatchRequest('msg-123', { status: 'archived' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(updateSetData.status).toBe('archived');
    });

    test('updates status to injected and sets injectedAt', async () => {
      const [request, context] = createPatchRequest('msg-123', { status: 'injected' });

      await PATCH(request, context);

      expect(updateSetData.status).toBe('injected');
      expect(updateSetData.injectedAt).toBeInstanceOf(Date);
    });

    test('does not update injectedAt if already set', async () => {
      mockMessage.injectedAt = new Date('2024-01-01');
      const [request, context] = createPatchRequest('msg-123', { status: 'injected' });

      await PATCH(request, context);

      expect(updateSetData.injectedAt).toBeUndefined();
    });
  });

  describe('authorization', () => {
    test('returns 404 when message not found', async () => {
      mockMessage = null;
      const [request, context] = createPatchRequest('nonexistent', { status: 'read' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when user does not own recipient agent', async () => {
      mockRecipientAgent = { id: 'agent-2', userId: 'different-user' };
      const [request, context] = createPatchRequest('msg-123', { status: 'read' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });

    test('returns 403 when recipient agent not found', async () => {
      mockRecipientAgent = null;
      const [request, context] = createPatchRequest('msg-123', { status: 'read' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('validation', () => {
    test('returns 422 for invalid status value', async () => {
      const [request, context] = createPatchRequest('msg-123', { status: 'invalid' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    test('accepts empty body (no changes)', async () => {
      const [request, context] = createPatchRequest('msg-123', {});

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});

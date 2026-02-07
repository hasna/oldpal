import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state
const validMessageId = '11111111-1111-1111-1111-111111111111';
const otherMessageId = '22222222-2222-2222-2222-222222222222';
let mockMessage: any = null;
let mockUserAssistants: any[] = [];
let mockRecipientAssistant: any = null;
let mockUpdatedMessage: any = null;
let updateSetData: any = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      assistantMessages: {
        findFirst: async () => mockMessage,
      },
      assistants: {
        findMany: async () => mockUserAssistants,
        findFirst: async () => mockRecipientAssistant,
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
  schema: createSchemaMock(),
}));

// Mock db schema
mock.module('@/db/schema', () => createSchemaMock({
  assistantMessages: 'assistantMessages',
  assistants: 'assistants',
}));

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => createAuthMiddlewareMock({
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
mock.module('drizzle-orm', () => createDrizzleOrmMock({
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
      id: validMessageId,
      fromAssistantId: 'assistant-1',
      toAssistantId: 'assistant-2',
      subject: 'Test message',
      content: 'Hello',
      status: 'unread',
    };
    mockUserAssistants = [{ id: 'assistant-1' }, { id: 'assistant-2' }];
    mockRecipientAssistant = null;
    mockUpdatedMessage = null;
    updateSetData = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL(`http://localhost:3001/api/v1/messages/${validMessageId}`);
      const request = new NextRequest(url);
      const context = { params: { id: validMessageId } };

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const [request, context] = createGetRequest(validMessageId, { token: 'invalid' });

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('message retrieval', () => {
    test('returns message when user owns sender assistant', async () => {
      mockMessage = {
        id: validMessageId,
        fromAssistantId: 'assistant-1',
        toAssistantId: 'assistant-other',
        content: 'Hello',
      };
      mockUserAssistants = [{ id: 'assistant-1' }];

      const [request, context] = createGetRequest(validMessageId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(validMessageId);
    });

    test('returns message when user owns recipient assistant', async () => {
      mockMessage = {
        id: validMessageId,
        fromAssistantId: 'assistant-other',
        toAssistantId: 'assistant-2',
        content: 'Hello',
      };
      mockUserAssistants = [{ id: 'assistant-2' }];

      const [request, context] = createGetRequest(validMessageId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.id).toBe(validMessageId);
    });

    test('returns 404 when message not found', async () => {
      mockMessage = null;
      const [request, context] = createGetRequest(otherMessageId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when user has no access to message', async () => {
      mockMessage = {
        id: validMessageId,
        fromAssistantId: 'assistant-other-1',
        toAssistantId: 'assistant-other-2',
        content: 'Hello',
      };
      mockUserAssistants = [{ id: 'assistant-mine' }]; // User has different assistants

      const [request, context] = createGetRequest(validMessageId);

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
      id: validMessageId,
      fromAssistantId: 'assistant-1',
      toAssistantId: 'assistant-2',
      subject: 'Test message',
      content: 'Hello',
      status: 'unread',
      readAt: null,
      injectedAt: null,
    };
    mockUserAssistants = [{ id: 'assistant-1' }, { id: 'assistant-2' }];
    mockRecipientAssistant = { id: 'assistant-2', userId: 'user-123' };
    mockUpdatedMessage = null;
    updateSetData = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL(`http://localhost:3001/api/v1/messages/${validMessageId}`);
      const request = new NextRequest(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      });
      const context = { params: { id: validMessageId } };

      const response = await PATCH(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('status updates', () => {
    test('updates status to read', async () => {
      const [request, context] = createPatchRequest(validMessageId, { status: 'read' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(updateSetData.status).toBe('read');
    });

    test('sets readAt when marking as read', async () => {
      const [request, context] = createPatchRequest(validMessageId, { status: 'read' });

      await PATCH(request, context);

      expect(updateSetData.readAt).toBeInstanceOf(Date);
    });

    test('does not update readAt if already set', async () => {
      mockMessage.readAt = new Date('2024-01-01');
      const [request, context] = createPatchRequest(validMessageId, { status: 'read' });

      await PATCH(request, context);

      expect(updateSetData.readAt).toBeUndefined();
    });

    test('updates status to archived', async () => {
      const [request, context] = createPatchRequest(validMessageId, { status: 'archived' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(updateSetData.status).toBe('archived');
    });

    test('updates status to injected and sets injectedAt', async () => {
      const [request, context] = createPatchRequest(validMessageId, { status: 'injected' });

      await PATCH(request, context);

      expect(updateSetData.status).toBe('injected');
      expect(updateSetData.injectedAt).toBeInstanceOf(Date);
    });

    test('does not update injectedAt if already set', async () => {
      mockMessage.injectedAt = new Date('2024-01-01');
      const [request, context] = createPatchRequest(validMessageId, { status: 'injected' });

      await PATCH(request, context);

      expect(updateSetData.injectedAt).toBeUndefined();
    });
  });

  describe('authorization', () => {
    test('returns 404 when message not found', async () => {
      mockMessage = null;
      const [request, context] = createPatchRequest(otherMessageId, { status: 'read' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when user does not own recipient assistant', async () => {
      mockUserAssistants = [{ id: 'assistant-mine' }];
      const [request, context] = createPatchRequest(validMessageId, { status: 'read' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });

    test('returns 403 when recipient assistant not found', async () => {
      mockUserAssistants = [];
      const [request, context] = createPatchRequest(validMessageId, { status: 'read' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('validation', () => {
    test('returns 422 for invalid status value', async () => {
      const [request, context] = createPatchRequest(validMessageId, { status: 'invalid' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    test('rejects empty body (no changes)', async () => {
      const [request, context] = createPatchRequest(validMessageId, {});

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });
});

afterAll(() => {
  mock.restore();
});

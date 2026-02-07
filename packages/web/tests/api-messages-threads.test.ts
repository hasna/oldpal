import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state
let mockUserAssistants: any[] = [];
let mockThreadMessages: any[] = [];
const threadId = '11111111-1111-1111-1111-111111111111';
const emptyThreadId = '22222222-2222-2222-2222-222222222222';

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      assistants: {
        findMany: async () => mockUserAssistants,
      },
      assistantMessages: {
        findMany: async () => mockThreadMessages,
      },
    },
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
  asc: (field: any) => ({ asc: field }),
  or: (...args: any[]) => ({ or: args }),
}));

const { GET } = await import('../src/app/api/v1/messages/threads/[threadId]/route');

function createRequest(
  threadId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { threadId: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/messages/threads/${threadId}`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { headers });
  const context = { params: { threadId } };

  return [request, context];
}

describe('GET /api/v1/messages/threads/:threadId', () => {
  beforeEach(() => {
    mockUserAssistants = [{ id: 'assistant-1' }, { id: 'assistant-2' }];
    mockThreadMessages = [
      {
        id: 'msg-1',
        threadId: threadId,
        fromAssistantId: 'assistant-1',
        toAssistantId: 'assistant-other',
        body: 'First message',
        createdAt: new Date('2024-01-01T10:00:00Z'),
      },
      {
        id: 'msg-2',
        threadId: threadId,
        fromAssistantId: 'assistant-other',
        toAssistantId: 'assistant-1',
        body: 'Reply',
        createdAt: new Date('2024-01-01T10:05:00Z'),
      },
      {
        id: 'msg-3',
        threadId: threadId,
        fromAssistantId: 'assistant-1',
        toAssistantId: 'assistant-other',
        body: 'Second reply',
        createdAt: new Date('2024-01-01T10:10:00Z'),
      },
    ];
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL(`http://localhost:3001/api/v1/messages/threads/${threadId}`);
      const request = new NextRequest(url);
      const context = { params: { threadId } };

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const [request, context] = createRequest(threadId, { token: 'invalid' });

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('thread retrieval', () => {
    test('returns all messages in thread when user has access', async () => {
      const [request, context] = createRequest(threadId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.threadId).toBe(threadId);
      expect(data.data.messages).toHaveLength(3);
      expect(data.data.count).toBe(3);
    });

    test('returns messages in chronological order', async () => {
      const [request, context] = createRequest(threadId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(data.data.messages[0].id).toBe('msg-1');
      expect(data.data.messages[1].id).toBe('msg-2');
      expect(data.data.messages[2].id).toBe('msg-3');
    });

    test('returns empty thread when no messages found', async () => {
      mockThreadMessages = [];
      const [request, context] = createRequest(emptyThreadId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.messages).toEqual([]);
      expect(data.data.count).toBe(0);
    });
  });

  describe('authorization', () => {
    test('returns 403 when user has no assistants', async () => {
      mockUserAssistants = [];
      const [request, context] = createRequest(threadId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });

    test('returns 403 when user has no access to any message in thread', async () => {
      // User has different assistants than the ones in the thread
      mockUserAssistants = [{ id: 'my-assistant-1' }, { id: 'my-assistant-2' }];
      mockThreadMessages = [
        {
          id: 'msg-1',
          threadId,
          fromAssistantId: 'other-assistant-1',
          toAssistantId: 'other-assistant-2',
          body: 'Message between others',
        },
      ];

      const [request, context] = createRequest(threadId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });

    test('grants access when user owns sender of any message', async () => {
      mockUserAssistants = [{ id: 'assistant-1' }];
      mockThreadMessages = [
        {
          id: 'msg-1',
          threadId: threadId,
          fromAssistantId: 'assistant-1',
          toAssistantId: 'other-assistant',
          body: 'I sent this',
        },
      ];

      const [request, context] = createRequest(threadId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('grants access when user owns recipient of any message', async () => {
      mockUserAssistants = [{ id: 'assistant-2' }];
      mockThreadMessages = [
        {
          id: 'msg-1',
          threadId: threadId,
          fromAssistantId: 'other-assistant',
          toAssistantId: 'assistant-2',
          body: 'Message to me',
        },
      ];

      const [request, context] = createRequest(threadId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('grants access if user owns one message in a larger thread', async () => {
      mockUserAssistants = [{ id: 'assistant-1' }];
      mockThreadMessages = [
        {
          id: 'msg-1',
          fromAssistantId: 'other-1',
          toAssistantId: 'other-2',
          body: 'Others talking',
        },
        {
          id: 'msg-2',
          fromAssistantId: 'other-2',
          toAssistantId: 'assistant-1',
          body: 'Message to me',
        },
        {
          id: 'msg-3',
          fromAssistantId: 'other-1',
          toAssistantId: 'other-2',
          body: 'More others talking',
        },
      ];

      const [request, context] = createRequest(threadId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Returns only messages accessible to the user
      expect(data.data.messages).toHaveLength(1);
    });
  });

  describe('message content', () => {
    test('includes all message fields in response', async () => {
      mockThreadMessages = [
        {
          id: 'msg-1',
          threadId: threadId,
          fromAssistantId: 'assistant-1',
          toAssistantId: 'assistant-2',
          subject: 'Test Subject',
          body: 'Hello',
          priority: 'high',
          status: 'read',
          createdAt: new Date(),
        },
      ];

      const [request, context] = createRequest(threadId);

      const response = await GET(request, context);
      const data = await response.json();

      const msg = data.data.messages[0];
      expect(msg).toHaveProperty('id');
      expect(msg).toHaveProperty('threadId');
      expect(msg).toHaveProperty('fromAssistantId');
      expect(msg).toHaveProperty('toAssistantId');
      expect(msg).toHaveProperty('body');
    });
  });
});

afterAll(() => {
  mock.restore();
});

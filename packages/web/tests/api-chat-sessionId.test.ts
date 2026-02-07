import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state
let mockSession: any = null;
let mockMessages: any[] = [];
let mockMessageCount = 0;
const sessionId = '11111111-1111-1111-1111-111111111111';
const missingSessionId = '22222222-2222-2222-2222-222222222222';

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      sessions: {
        findFirst: async () => mockSession,
      },
      messages: {
        findMany: async ({ limit, offset }: any) => {
          const start = offset || 0;
          const end = start + (limit || mockMessages.length);
          return mockMessages.slice(start, end);
        },
      },
    },
    select: () => ({
      from: () => ({
        where: () => [{ total: mockMessageCount }],
      }),
    }),
  },
  schema: createSchemaMock(),
}));

// Mock db schema
mock.module('@/db/schema', () => createSchemaMock({
  sessions: 'sessions',
  messages: 'messages',
}));

// Mock auth middleware - simulates withAuth behavior
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
    // Add user to request
    (req as any).user = { userId: 'user-123', email: 'test@example.com', role: 'user' };
    return handler(req, context);
  },
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
  asc: (field: any) => ({ asc: field }),
  count: () => 'count',
  and: (...args: any[]) => ({ and: args }),
}));

const { GET } = await import('../src/app/api/v1/chat/[sessionId]/route');

function createRequest(
  sessionId: string,
  options: { page?: number; limit?: number; token?: string } = {}
): [NextRequest, { params: { sessionId: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/chat/${sessionId}`);
  if (options.page) url.searchParams.set('page', options.page.toString());
  if (options.limit) url.searchParams.set('limit', options.limit.toString());

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { headers });
  const context = { params: { sessionId } };

  return [request, context];
}

describe('GET /api/v1/chat/:sessionId', () => {
  beforeEach(() => {
    mockSession = {
      id: sessionId,
      userId: 'user-123',
      assistantId: 'assistant-1',
      createdAt: new Date(),
    };
    mockMessages = [
      { id: 'msg-1', sessionId: sessionId, role: 'user', content: 'Hello' },
      { id: 'msg-2', sessionId: sessionId, role: 'assistant', content: 'Hi there!' },
      { id: 'msg-3', sessionId: sessionId, role: 'user', content: 'How are you?' },
    ];
    mockMessageCount = 3;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const [request, context] = createRequest(sessionId, { token: '' });
      request.headers.delete('Authorization');
      const req = new NextRequest(request.url);

      const response = await GET(req, context);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const [request, context] = createRequest(sessionId, { token: 'invalid' });

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('session validation', () => {
    test('returns 404 when session not found', async () => {
      mockSession = null;
      const [request, context] = createRequest(missingSessionId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when session belongs to different user', async () => {
      mockSession = {
        id: sessionId,
        userId: 'different-user',
        assistantId: 'assistant-1',
      };
      const [request, context] = createRequest(sessionId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('successful retrieval', () => {
    test('returns paginated messages for valid session', async () => {
      const [request, context] = createRequest(sessionId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(3);
      expect(data.data.total).toBe(3);
    });

    test('includes pagination metadata', async () => {
      const [request, context] = createRequest(sessionId, { page: 1, limit: 10 });

      const response = await GET(request, context);
      const data = await response.json();

      expect(data.data.page).toBe(1);
      expect(data.data.limit).toBe(10);
      expect(data.data.totalPages).toBe(1);
    });

    test('returns empty array when no messages', async () => {
      mockMessages = [];
      mockMessageCount = 0;
      const [request, context] = createRequest(sessionId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.items).toHaveLength(0);
      expect(data.data.total).toBe(0);
    });
  });

  describe('pagination', () => {
    test('defaults to page 1 and limit 50', async () => {
      mockMessages = Array.from({ length: 60 }, (_, i) => ({
        id: `msg-${i}`,
        sessionId: sessionId,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));
      mockMessageCount = 60;

      const [request, context] = createRequest(sessionId);

      const response = await GET(request, context);
      const data = await response.json();

      // Our mock returns up to limit items
      expect(data.data.items.length).toBeLessThanOrEqual(50);
      expect(data.data.page).toBe(1);
      expect(data.data.limit).toBe(50);
    });

    test('respects custom page parameter', async () => {
      const [request, context] = createRequest(sessionId, { page: 2 });

      const response = await GET(request, context);
      const data = await response.json();

      expect(data.data.page).toBe(2);
    });

    test('respects custom limit parameter', async () => {
      const [request, context] = createRequest(sessionId, { limit: 25 });

      const response = await GET(request, context);
      const data = await response.json();

      expect(data.data.limit).toBe(25);
    });

    test('enforces maximum limit of 100', async () => {
      const [request, context] = createRequest(sessionId, { limit: 200 });

      const response = await GET(request, context);
      const data = await response.json();

      expect(data.data.limit).toBe(100);
    });

    test('defaults to 50 when limit is 0 (falsy)', async () => {
      const [request, context] = createRequest(sessionId, { limit: 0 });

      const response = await GET(request, context);
      const data = await response.json();

      // When 0, parseInt returns 0 which is falsy, so || 50 triggers
      expect(data.data.limit).toBe(50);
    });

    test('enforces minimum page of 1', async () => {
      const [request, context] = createRequest(sessionId, { page: 0 });

      const response = await GET(request, context);
      const data = await response.json();

      expect(data.data.page).toBe(1);
    });

    test('handles invalid page/limit values', async () => {
      const url = new URL('http://localhost:3001/api/v1/chat/session-123');
      url.searchParams.set('page', 'invalid');
      url.searchParams.set('limit', 'invalid');

      const request = new NextRequest(url, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      const context = { params: { sessionId: sessionId } };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Falls back to defaults
      expect(data.data.page).toBe(1);
      expect(data.data.limit).toBe(50);
    });
  });

  describe('message content', () => {
    test('returns messages in chronological order', async () => {
      const [request, context] = createRequest(sessionId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(data.data.items[0].id).toBe('msg-1');
      expect(data.data.items[1].id).toBe('msg-2');
      expect(data.data.items[2].id).toBe('msg-3');
    });

    test('includes all message fields', async () => {
      const [request, context] = createRequest(sessionId);

      const response = await GET(request, context);
      const data = await response.json();

      const firstMessage = data.data.items[0];
      expect(firstMessage).toHaveProperty('id');
      expect(firstMessage).toHaveProperty('sessionId');
      expect(firstMessage).toHaveProperty('role');
      expect(firstMessage).toHaveProperty('content');
    });
  });
});

afterAll(() => {
  mock.restore();
});

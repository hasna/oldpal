import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state
let mockUserAssistants: any[] = [];
let mockMessages: any[] = [];
let mockMessageCount = 0;
let mockFromAssistant: any = null;
let mockToAssistant: any = null;
let mockInsertedMessage: any = null;
let insertValuesData: any = null;
let mockParentMessage: any = null;
const assistantId1 = '11111111-1111-1111-1111-111111111111';
const assistantId2 = '22222222-2222-2222-2222-222222222222';
const parentMessageId = '33333333-3333-3333-3333-333333333333';

// Track which assistant is being queried
let assistantQueryCount = 0;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      assistants: {
        findMany: async () => mockUserAssistants,
        findFirst: async () => {
          assistantQueryCount++;
          // First query is for fromAssistant, second is for toAssistant
          if (assistantQueryCount === 1) {
            return mockFromAssistant;
          }
          return mockToAssistant;
        },
      },
      assistantMessages: {
        findMany: async ({ limit, offset }: any) => {
          const start = offset || 0;
          const end = start + (limit || mockMessages.length);
          return mockMessages.slice(start, end);
        },
        findFirst: async () => mockParentMessage,
      },
    },
    select: () => ({
      from: () => ({
        where: () => [{ total: mockMessageCount }],
      }),
    }),
    insert: (table: any) => ({
      values: (data: any) => {
        insertValuesData = data;
        return {
          returning: () => [
            mockInsertedMessage || {
              id: 'new-msg-id',
              ...data,
              createdAt: new Date(),
            },
          ],
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
  withAuth: (handler: any) => async (req: any) => {
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
    return handler(req);
  },
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
  desc: (field: any) => ({ desc: field }),
  count: () => 'count',
  and: (...args: any[]) => ({ and: args }),
  or: (...args: any[]) => ({ or: args }),
  isNull: (field: any) => ({ isNull: field }),
}));

let GET: typeof import('../src/app/api/v1/messages/route').GET;
let POST: typeof import('../src/app/api/v1/messages/route').POST;

beforeEach(async () => {
  const mod = await import(`../src/app/api/v1/messages/route?test=${Date.now()}-${Math.random()}`);
  GET = mod.GET;
  POST = mod.POST;
});

function createGetRequest(
  params: { page?: number; limit?: number; status?: string; assistantId?: string } = {},
  options: { token?: string } = {}
): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/messages');
  if (params.page) url.searchParams.set('page', params.page.toString());
  if (params.limit) url.searchParams.set('limit', params.limit.toString());
  if (params.status) url.searchParams.set('status', params.status);
  if (params.assistantId) url.searchParams.set('assistantId', params.assistantId);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  return new NextRequest(url, { headers });
}

function createPostRequest(
  body: Record<string, unknown>,
  options: { token?: string } = {}
): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/messages');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('GET /api/v1/messages', () => {
  beforeEach(() => {
    mockUserAssistants = [{ id: assistantId1 }, { id: assistantId2 }];
    mockMessages = [
      { id: 'msg-1', toAssistantId: assistantId1, subject: 'Test 1', status: 'unread' },
      { id: 'msg-2', toAssistantId: assistantId2, subject: 'Test 2', status: 'read' },
      { id: 'msg-3', toAssistantId: assistantId1, subject: 'Test 3', status: 'unread' },
    ];
    mockMessageCount = 3;
    mockFromAssistant = null;
    mockToAssistant = null;
    mockInsertedMessage = null;
    insertValuesData = null;
    mockParentMessage = null;
    assistantQueryCount = 0;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const request = new NextRequest('http://localhost:3001/api/v1/messages');

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createGetRequest({}, { token: 'invalid' });

      const response = await GET(request);

      expect(response.status).toBe(401);
    });
  });

  describe('listing messages', () => {
    test('returns paginated messages', async () => {
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(3);
      expect(data.data.total).toBe(3);
    });

    test('returns empty list when user has no assistants', async () => {
      mockUserAssistants = [];
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.items).toEqual([]);
      expect(data.data.total).toBe(0);
    });

    test('includes pagination metadata', async () => {
      const request = createGetRequest({ page: 1, limit: 10 });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(1);
      expect(data.data.limit).toBe(10);
      expect(data.data.totalPages).toBe(1);
    });
  });

  describe('filtering', () => {
    test('filters by status', async () => {
      const request = createGetRequest({ status: 'unread' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('filters by assistantId when user owns the assistant', async () => {
      const request = createGetRequest({ assistantId: assistantId1 });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('pagination', () => {
    test('defaults to page 1 and limit 20', async () => {
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(1);
      expect(data.data.limit).toBe(20);
    });

    test('respects custom page and limit', async () => {
      const request = createGetRequest({ page: 2, limit: 5 });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(2);
      expect(data.data.limit).toBe(5);
    });

    test('enforces maximum limit of 100', async () => {
      const request = createGetRequest({ limit: 200 });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.limit).toBe(100);
    });
  });
});

describe('POST /api/v1/messages', () => {
  beforeEach(() => {
    mockUserAssistants = [{ id: assistantId1 }, { id: assistantId2 }];
    mockMessages = [];
    mockMessageCount = 0;
    mockFromAssistant = { id: assistantId1, userId: 'user-123' };
    mockToAssistant = { id: assistantId2, userId: 'user-123' };
    mockInsertedMessage = null;
    insertValuesData = null;
    mockParentMessage = null;
    assistantQueryCount = 0;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const request = new NextRequest('http://localhost:3001/api/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toAssistantId: assistantId2,
          body: 'Hello',
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
    });
  });

  describe('sending messages', () => {
    test('creates message with required fields', async () => {
      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
        body: 'Hello, world!',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(insertValuesData.body).toBe('Hello, world!');
    });

    test('creates message with all optional fields', async () => {
      mockParentMessage = {
        id: parentMessageId,
        threadId: '550e8400-e29b-41d4-a716-446655440002',
        fromAssistantId: assistantId1,
        toAssistantId: assistantId2,
      };
      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
        fromAssistantId: '550e8400-e29b-41d4-a716-446655440001',
        subject: 'Test Subject',
        body: 'Hello, world!',
        priority: 'high',
        threadId: '550e8400-e29b-41d4-a716-446655440002',
        parentId: parentMessageId,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(insertValuesData.subject).toBe('Test Subject');
      expect(insertValuesData.priority).toBe('high');
    });

    test('generates threadId if not provided', async () => {
      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
        body: 'Hello',
      });

      await POST(request);

      expect(insertValuesData.threadId).toBeDefined();
    });

    test('defaults priority to normal', async () => {
      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
        body: 'Hello',
      });

      await POST(request);

      expect(insertValuesData.priority).toBe('normal');
    });
  });

  describe('authorization', () => {
    test('returns 403 when user does not own sender assistant', async () => {
      mockFromAssistant = { id: 'assistant-other', userId: 'different-user' };
      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
        fromAssistantId: '550e8400-e29b-41d4-a716-446655440001',
        body: 'Hello',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.message).toContain('do not own the sender assistant');
    });

    test('returns 403 when sender assistant not found', async () => {
      mockFromAssistant = null;
      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
        fromAssistantId: '550e8400-e29b-41d4-a716-446655440001',
        body: 'Hello',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
    });

    test('returns 404 when recipient assistant not found', async () => {
      mockFromAssistant = null; // Skip fromAssistant check
      mockToAssistant = null;
      assistantQueryCount = 0;

      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
        body: 'Hello',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.message).toContain('Recipient assistant not found');
    });
  });

  describe('validation', () => {
    test('returns 422 for invalid toAssistantId format', async () => {
      const request = createPostRequest({
        toAssistantId: 'not-a-uuid',
        body: 'Hello',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    test('returns 422 when body is empty', async () => {
      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
        body: '',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(422);
    });

    test('returns 422 when body is missing', async () => {
      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(422);
    });

    test('returns 422 for invalid priority value', async () => {
      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
        body: 'Hello',
        priority: 'invalid',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(422);
    });

    test('returns 422 when subject exceeds 500 characters', async () => {
      const request = createPostRequest({
        toAssistantId: '550e8400-e29b-41d4-a716-446655440000',
        body: 'Hello',
        subject: 'a'.repeat(501),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(422);
    });
  });
});

afterAll(() => {
  mock.restore();
});

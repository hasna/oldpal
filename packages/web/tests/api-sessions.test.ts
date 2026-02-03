import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock state
let mockSessions: any[] = [];
let mockSessionCount = 0;
let mockInsertedSession: any = null;
let insertValuesData: any = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      sessions: {
        findMany: async ({ limit, offset }: any) => {
          const start = offset || 0;
          const end = start + (limit || mockSessions.length);
          return mockSessions.slice(start, end);
        },
      },
    },
    select: () => ({
      from: () => ({
        where: () => [{ total: mockSessionCount }],
      }),
    }),
    insert: (table: any) => ({
      values: (data: any) => {
        insertValuesData = data;
        return {
          returning: () => [
            mockInsertedSession || {
              id: 'new-session-id',
              ...data,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        };
      },
    }),
  },
}));

// Mock db schema
mock.module('@/db/schema', () => ({
  sessions: 'sessions',
}));

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => ({
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
mock.module('drizzle-orm', () => ({
  eq: (field: any, value: any) => ({ field, value }),
  desc: (field: any) => ({ desc: field }),
  count: () => 'count',
}));

const { GET, POST } = await import('../src/app/api/v1/sessions/route');

function createGetRequest(
  params: { page?: number; limit?: number } = {},
  options: { token?: string } = {}
): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/sessions');
  if (params.page) url.searchParams.set('page', params.page.toString());
  if (params.limit) url.searchParams.set('limit', params.limit.toString());

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
  const url = new URL('http://localhost:3001/api/v1/sessions');

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

describe('GET /api/v1/sessions', () => {
  beforeEach(() => {
    mockSessions = [
      {
        id: 'session-1',
        userId: 'user-123',
        label: 'Session 1',
        agent: { id: 'agent-1', name: 'Agent 1', avatar: null },
        updatedAt: new Date('2024-01-03'),
      },
      {
        id: 'session-2',
        userId: 'user-123',
        label: 'Session 2',
        agent: { id: 'agent-2', name: 'Agent 2', avatar: null },
        updatedAt: new Date('2024-01-02'),
      },
      {
        id: 'session-3',
        userId: 'user-123',
        label: 'Session 3',
        agent: null,
        updatedAt: new Date('2024-01-01'),
      },
    ];
    mockSessionCount = 3;
    mockInsertedSession = null;
    insertValuesData = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const request = new NextRequest('http://localhost:3001/api/v1/sessions');

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createGetRequest({}, { token: 'invalid' });

      const response = await GET(request);

      expect(response.status).toBe(401);
    });
  });

  describe('listing sessions', () => {
    test('returns paginated sessions', async () => {
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(3);
      expect(data.data.total).toBe(3);
    });

    test('includes agent relation in response', async () => {
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.items[0].agent).toBeDefined();
      expect(data.data.items[0].agent.name).toBe('Agent 1');
    });

    test('returns empty list when no sessions', async () => {
      mockSessions = [];
      mockSessionCount = 0;
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

    test('enforces minimum page of 1', async () => {
      const request = createGetRequest({ page: 0 });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(1);
    });
  });
});

describe('POST /api/v1/sessions', () => {
  beforeEach(() => {
    mockSessions = [];
    mockSessionCount = 0;
    mockInsertedSession = null;
    insertValuesData = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const request = new NextRequest('http://localhost:3001/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
    });
  });

  describe('session creation', () => {
    test('creates session with empty body', async () => {
      const request = createPostRequest({});

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(insertValuesData.userId).toBe('user-123');
    });

    test('creates session with all optional fields', async () => {
      const request = createPostRequest({
        label: 'My Session',
        cwd: '/home/user',
        agentId: '550e8400-e29b-41d4-a716-446655440000',
        metadata: { key: 'value' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(insertValuesData.label).toBe('My Session');
      expect(insertValuesData.cwd).toBe('/home/user');
      expect(insertValuesData.agentId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(insertValuesData.metadata).toEqual({ key: 'value' });
    });

    test('creates session with only label', async () => {
      const request = createPostRequest({ label: 'Quick Session' });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(insertValuesData.label).toBe('Quick Session');
    });

    test('sets userId from authenticated user', async () => {
      const request = createPostRequest({});

      await POST(request);

      expect(insertValuesData.userId).toBe('user-123');
    });
  });

  describe('validation', () => {
    test('returns 422 when label exceeds 255 characters', async () => {
      const request = createPostRequest({
        label: 'a'.repeat(256),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    test('returns 422 for invalid agentId format', async () => {
      const request = createPostRequest({
        agentId: 'not-a-uuid',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

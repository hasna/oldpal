import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state
let mockAssistants: any[] = [];
let mockAssistantCount = 0;
let mockInsertedAssistant: any = null;
let insertValuesData: any = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      assistants: {
        findMany: async ({ limit, offset }: any) => {
          const start = offset || 0;
          const end = start + (limit || mockAssistants.length);
          return mockAssistants.slice(start, end);
        },
      },
    },
    select: () => ({
      from: () => ({
        where: () => [{ total: mockAssistantCount }],
      }),
    }),
    insert: (table: any) => ({
      values: (data: any) => {
        insertValuesData = data;
        return {
          returning: () => [
            mockInsertedAssistant || {
              id: 'new-assistant-id',
              ...data,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
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
}));

const { GET, POST } = await import('../src/app/api/v1/assistants/route');

function createGetRequest(
  params: { page?: number; limit?: number; active?: string } = {},
  options: { token?: string } = {}
): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/assistants');
  if (params.page) url.searchParams.set('page', params.page.toString());
  if (params.limit) url.searchParams.set('limit', params.limit.toString());
  if (params.active) url.searchParams.set('active', params.active);

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
  const url = new URL('http://localhost:3001/api/v1/assistants');

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

describe('GET /api/v1/assistants', () => {
  beforeEach(() => {
    mockAssistants = [
      {
        id: 'assistant-1',
        userId: 'user-123',
        name: 'Assistant 1',
        isActive: true,
        updatedAt: new Date('2024-01-03'),
      },
      {
        id: 'assistant-2',
        userId: 'user-123',
        name: 'Assistant 2',
        isActive: false,
        updatedAt: new Date('2024-01-02'),
      },
      {
        id: 'assistant-3',
        userId: 'user-123',
        name: 'Assistant 3',
        isActive: true,
        updatedAt: new Date('2024-01-01'),
      },
    ];
    mockAssistantCount = 3;
    mockInsertedAssistant = null;
    insertValuesData = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const request = new NextRequest('http://localhost:3001/api/v1/assistants');

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createGetRequest({}, { token: 'invalid' });

      const response = await GET(request);

      expect(response.status).toBe(401);
    });
  });

  describe('listing assistants', () => {
    test('returns paginated assistants', async () => {
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(3);
      expect(data.data.total).toBe(3);
    });

    test('returns empty list when no assistants', async () => {
      mockAssistants = [];
      mockAssistantCount = 0;
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
    test('filters by active=true', async () => {
      const request = createGetRequest({ active: 'true' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('returns all assistants when active filter not set', async () => {
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.items).toHaveLength(3);
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

describe('POST /api/v1/assistants', () => {
  beforeEach(() => {
    mockAssistants = [];
    mockAssistantCount = 0;
    mockInsertedAssistant = null;
    insertValuesData = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const request = new NextRequest('http://localhost:3001/api/v1/assistants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Assistant' }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
    });
  });

  describe('assistant creation', () => {
    test('creates assistant with required name only', async () => {
      const request = createPostRequest({ name: 'My Assistant' });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(insertValuesData.name).toBe('My Assistant');
      expect(insertValuesData.userId).toBe('user-123');
    });

    test('creates assistant with all optional fields', async () => {
      const request = createPostRequest({
        name: 'Full Assistant',
        description: 'A fully configured assistant',
        avatar: 'https://example.com/avatar.png',
        model: 'claude-3-opus',
        systemPrompt: 'You are a helpful assistant',
        settings: {
          temperature: 0.7,
          maxTokens: 2000,
          tools: ['bash', 'read'],
          skills: ['skill1'],
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(insertValuesData.description).toBe('A fully configured assistant');
      expect(insertValuesData.avatar).toBe('https://example.com/avatar.png');
      expect(insertValuesData.model).toBe('claude-3-opus');
      expect(insertValuesData.systemPrompt).toBe('You are a helpful assistant');
      expect(insertValuesData.settings.temperature).toBe(0.7);
    });

    test('uses default model when not specified', async () => {
      const request = createPostRequest({ name: 'Assistant' });

      await POST(request);

      expect(insertValuesData.model).toBe('claude-sonnet-4-20250514');
    });

    test('sets userId from authenticated user', async () => {
      const request = createPostRequest({ name: 'Assistant' });

      await POST(request);

      expect(insertValuesData.userId).toBe('user-123');
    });
  });

  describe('validation', () => {
    test('returns 422 when name is missing', async () => {
      const request = createPostRequest({});

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    test('returns 422 when name is empty', async () => {
      const request = createPostRequest({ name: '' });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });

    test('returns 422 when name exceeds 255 characters', async () => {
      const request = createPostRequest({ name: 'a'.repeat(256) });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });

    test('returns 422 for invalid avatar URL', async () => {
      const request = createPostRequest({ name: 'Assistant', avatar: 'not-a-url' });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });

    test('returns 422 when model exceeds 100 characters', async () => {
      const request = createPostRequest({ name: 'Assistant', model: 'a'.repeat(101) });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });

    test('returns 422 for invalid temperature (> 2)', async () => {
      const request = createPostRequest({
        name: 'Assistant',
        settings: { temperature: 3 },
      });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });

    test('returns 422 for negative temperature', async () => {
      const request = createPostRequest({
        name: 'Assistant',
        settings: { temperature: -1 },
      });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });

    test('returns 422 for non-positive maxTokens', async () => {
      const request = createPostRequest({
        name: 'Assistant',
        settings: { maxTokens: 0 },
      });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });
  });
});

afterAll(() => {
  mock.restore();
});

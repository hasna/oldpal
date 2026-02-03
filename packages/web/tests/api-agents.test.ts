import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock state
let mockAgents: any[] = [];
let mockAgentCount = 0;
let mockInsertedAgent: any = null;
let insertValuesData: any = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      agents: {
        findMany: async ({ limit, offset }: any) => {
          const start = offset || 0;
          const end = start + (limit || mockAgents.length);
          return mockAgents.slice(start, end);
        },
      },
    },
    select: () => ({
      from: () => ({
        where: () => [{ total: mockAgentCount }],
      }),
    }),
    insert: (table: any) => ({
      values: (data: any) => {
        insertValuesData = data;
        return {
          returning: () => [
            mockInsertedAgent || {
              id: 'new-agent-id',
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
}));

// Mock db schema
mock.module('@/db/schema', () => ({
  agents: 'agents',
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
  and: (...args: any[]) => ({ and: args }),
}));

const { GET, POST } = await import('../src/app/api/v1/agents/route');

function createGetRequest(
  params: { page?: number; limit?: number; active?: string } = {},
  options: { token?: string } = {}
): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/agents');
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
  const url = new URL('http://localhost:3001/api/v1/agents');

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

describe('GET /api/v1/agents', () => {
  beforeEach(() => {
    mockAgents = [
      {
        id: 'agent-1',
        userId: 'user-123',
        name: 'Agent 1',
        isActive: true,
        updatedAt: new Date('2024-01-03'),
      },
      {
        id: 'agent-2',
        userId: 'user-123',
        name: 'Agent 2',
        isActive: false,
        updatedAt: new Date('2024-01-02'),
      },
      {
        id: 'agent-3',
        userId: 'user-123',
        name: 'Agent 3',
        isActive: true,
        updatedAt: new Date('2024-01-01'),
      },
    ];
    mockAgentCount = 3;
    mockInsertedAgent = null;
    insertValuesData = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const request = new NextRequest('http://localhost:3001/api/v1/agents');

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createGetRequest({}, { token: 'invalid' });

      const response = await GET(request);

      expect(response.status).toBe(401);
    });
  });

  describe('listing agents', () => {
    test('returns paginated agents', async () => {
      const request = createGetRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(3);
      expect(data.data.total).toBe(3);
    });

    test('returns empty list when no agents', async () => {
      mockAgents = [];
      mockAgentCount = 0;
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

    test('returns all agents when active filter not set', async () => {
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

describe('POST /api/v1/agents', () => {
  beforeEach(() => {
    mockAgents = [];
    mockAgentCount = 0;
    mockInsertedAgent = null;
    insertValuesData = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const request = new NextRequest('http://localhost:3001/api/v1/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Agent' }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
    });
  });

  describe('agent creation', () => {
    test('creates agent with required name only', async () => {
      const request = createPostRequest({ name: 'My Agent' });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(insertValuesData.name).toBe('My Agent');
      expect(insertValuesData.userId).toBe('user-123');
    });

    test('creates agent with all optional fields', async () => {
      const request = createPostRequest({
        name: 'Full Agent',
        description: 'A fully configured agent',
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
      expect(insertValuesData.description).toBe('A fully configured agent');
      expect(insertValuesData.avatar).toBe('https://example.com/avatar.png');
      expect(insertValuesData.model).toBe('claude-3-opus');
      expect(insertValuesData.systemPrompt).toBe('You are a helpful assistant');
      expect(insertValuesData.settings.temperature).toBe(0.7);
    });

    test('uses default model when not specified', async () => {
      const request = createPostRequest({ name: 'Agent' });

      await POST(request);

      expect(insertValuesData.model).toBe('claude-sonnet-4-20250514');
    });

    test('sets userId from authenticated user', async () => {
      const request = createPostRequest({ name: 'Agent' });

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
      const request = createPostRequest({ name: 'Agent', avatar: 'not-a-url' });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });

    test('returns 422 when model exceeds 100 characters', async () => {
      const request = createPostRequest({ name: 'Agent', model: 'a'.repeat(101) });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });

    test('returns 422 for invalid temperature (> 2)', async () => {
      const request = createPostRequest({
        name: 'Agent',
        settings: { temperature: 3 },
      });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });

    test('returns 422 for negative temperature', async () => {
      const request = createPostRequest({
        name: 'Agent',
        settings: { temperature: -1 },
      });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });

    test('returns 422 for non-positive maxTokens', async () => {
      const request = createPostRequest({
        name: 'Agent',
        settings: { maxTokens: 0 },
      });

      const response = await POST(request);

      expect(response.status).toBe(422);
    });
  });
});

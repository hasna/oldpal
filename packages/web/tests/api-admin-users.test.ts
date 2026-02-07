import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state
let mockUsers: any[] = [];
let mockUserCount = 0;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      users: {
        findMany: async ({ limit, offset }: any) => {
          const start = offset || 0;
          const end = start + (limit || mockUsers.length);
          return mockUsers.slice(start, end);
        },
      },
    },
    select: () => ({
      from: () => {
        const result = Promise.resolve([{ total: mockUserCount }]);
        return {
          where: () => result,
          then: result.then.bind(result),
        };
      },
    }),
  },
  schema: createSchemaMock(),
}));

// Mock db schema
mock.module('@/db/schema', () => createSchemaMock({
  users: 'users',
}));

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => createAuthMiddlewareMock({
  withAdminAuth: (handler: any) => async (req: any) => {
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
    if (token === 'user-token') {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
        { status: 403 }
      );
    }
    (req as any).user = { userId: 'admin-123', email: 'admin@example.com', role: 'admin' };
    return handler(req);
  },
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  count: () => 'count',
  desc: (field: any) => ({ desc: field }),
  ilike: (field: any, value: any) => ({ ilike: [field, value] }),
  or: (...args: any[]) => ({ or: args }),
}));

const { GET } = await import('../src/app/api/v1/admin/users/route');

function createRequest(
  params: { page?: number; limit?: number; search?: string } = {},
  options: { token?: string } = {}
): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/admin/users');
  if (params.page) url.searchParams.set('page', params.page.toString());
  if (params.limit) url.searchParams.set('limit', params.limit.toString());
  if (params.search) url.searchParams.set('search', params.search);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer admin-token';
  }

  return new NextRequest(url, { headers });
}

describe('GET /api/v1/admin/users', () => {
  beforeEach(() => {
    mockUsers = [
      {
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user',
        emailVerified: true,
        avatarUrl: null,
        createdAt: new Date('2024-01-03'),
      },
      {
        id: 'user-2',
        email: 'bob@example.com',
        name: 'Bob',
        role: 'admin',
        emailVerified: true,
        avatarUrl: 'https://example.com/avatar.png',
        createdAt: new Date('2024-01-02'),
      },
      {
        id: 'user-3',
        email: 'charlie@example.com',
        name: 'Charlie',
        role: 'user',
        emailVerified: false,
        avatarUrl: null,
        createdAt: new Date('2024-01-01'),
      },
    ];
    mockUserCount = 3;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/admin/users');
      const request = new NextRequest(url);

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createRequest({}, { token: 'invalid' });

      const response = await GET(request);

      expect(response.status).toBe(401);
    });
  });

  describe('authorization', () => {
    test('returns 403 for non-admin users', async () => {
      const request = createRequest({}, { token: 'user-token' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
      expect(data.error.message).toBe('Admin access required');
    });
  });

  describe('user listing', () => {
    test('returns paginated list of users', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(3);
      expect(data.data.total).toBe(3);
    });

    test('returns user data with expected fields', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const user = data.data.items[0];
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('name');
      expect(user).toHaveProperty('role');
      expect(user).toHaveProperty('emailVerified');
      expect(user).toHaveProperty('avatarUrl');
      expect(user).toHaveProperty('createdAt');
    });

    test('returns empty list when no users', async () => {
      mockUsers = [];
      mockUserCount = 0;
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.items).toEqual([]);
      expect(data.data.total).toBe(0);
    });

    test('includes pagination metadata', async () => {
      const request = createRequest({ page: 1, limit: 10 });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(1);
      expect(data.data.limit).toBe(10);
      expect(data.data.totalPages).toBe(1);
    });
  });

  describe('pagination', () => {
    test('defaults to page 1 and limit 20', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(1);
      expect(data.data.limit).toBe(20);
    });

    test('respects custom page and limit', async () => {
      const request = createRequest({ page: 2, limit: 5 });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(2);
      expect(data.data.limit).toBe(5);
    });

    test('enforces maximum limit of 100', async () => {
      const request = createRequest({ limit: 200 });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.limit).toBe(100);
    });

    test('enforces minimum page of 1', async () => {
      const request = createRequest({ page: 0 });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(1);
    });

    test('enforces minimum limit of 1', async () => {
      const request = createRequest({ limit: 0 });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.limit).toBe(20);
    });
  });

  describe('search filtering', () => {
    test('accepts search parameter', async () => {
      const request = createRequest({ search: 'alice' });

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test('returns all users when search not provided', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.items).toHaveLength(3);
    });
  });

  describe('response format', () => {
    test('returns users with correct role values', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const roles = data.data.items.map((u: any) => u.role);
      expect(roles).toContain('user');
      expect(roles).toContain('admin');
    });

    test('returns users with emailVerified boolean', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(typeof data.data.items[0].emailVerified).toBe('boolean');
    });

    test('handles null avatarUrl', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const userWithNullAvatar = data.data.items.find((u: any) => u.avatarUrl === null);
      expect(userWithNullAvatar).toBeDefined();
    });

    test('includes avatarUrl when present', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      const userWithAvatar = data.data.items.find((u: any) => u.avatarUrl !== null);
      expect(userWithAvatar.avatarUrl).toBe('https://example.com/avatar.png');
    });
  });
});

afterAll(() => {
  mock.restore();
});

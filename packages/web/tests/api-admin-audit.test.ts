import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock data
let mockLogs: any[] = [];
let mockTotal = 0;

// Create full chain mock that handles any chaining pattern
function createChainMock(finalResult: any) {
  const chainableResult = () => Promise.resolve(finalResult);
  const chainable: any = {
    from: () => chainable,
    leftJoin: () => chainable,
    where: () => chainable,
    orderBy: () => chainable,
    limit: () => chainable,
    offset: () => chainableResult(),
    then: (fn: any) => chainableResult().then(fn),
  };
  return chainable;
}

// Mock database - handles the Promise.all pattern in the route
mock.module('@/db', () => ({
  db: {
    select: (fields: any) => {
      const fieldKeys = Object.keys(fields);
      // Check if this is a count query
      if (fieldKeys.includes('total')) {
        return createChainMock([{ total: mockTotal }]);
      }
      // This is the main logs query
      return createChainMock(mockLogs);
    },
  },
}));

// Mock db schema
mock.module('@/db/schema', () => ({
  adminAuditLogs: {
    id: 'id',
    action: 'action',
    targetType: 'targetType',
    targetId: 'targetId',
    changes: 'changes',
    metadata: 'metadata',
    ipAddress: 'ipAddress',
    createdAt: 'createdAt',
    adminUserId: 'adminUserId',
  },
  users: {
    id: 'id',
    email: 'email',
    name: 'name',
  },
}));

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => ({
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

// Mock API response helpers
mock.module('@/lib/api/response', () => ({
  paginatedResponse: (items: any[], total: number, page: number, limit: number) => {
    return NextResponse.json({
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  },
  errorResponse: (error: any) => {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } },
      { status: 500 }
    );
  },
}));

// Mock API errors
mock.module('@/lib/api/errors', () => ({
  isValidUUID: (id: string) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  },
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => ({
  count: () => ({ count: 'count' }),
  desc: (field: any) => ({ desc: field }),
  eq: (field: any, value: any) => ({ eq: [field, value] }),
  and: (...args: any[]) => ({ and: args }),
  gte: (field: any, value: any) => ({ gte: [field, value] }),
  lte: (field: any, value: any) => ({ lte: [field, value] }),
}));

const { GET } = await import('../src/app/api/v1/admin/audit/route');

function createRequest(options: {
  token?: string;
  page?: number;
  limit?: number;
  action?: string;
  adminId?: string;
  targetType?: string;
  startDate?: string;
  endDate?: string;
} = {}): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/admin/audit');
  if (options.page) url.searchParams.set('page', String(options.page));
  if (options.limit) url.searchParams.set('limit', String(options.limit));
  if (options.action) url.searchParams.set('action', options.action);
  if (options.adminId) url.searchParams.set('adminId', options.adminId);
  if (options.targetType) url.searchParams.set('targetType', options.targetType);
  if (options.startDate) url.searchParams.set('startDate', options.startDate);
  if (options.endDate) url.searchParams.set('endDate', options.endDate);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer admin-token';
  }

  return new NextRequest(url, { headers });
}

describe('GET /api/v1/admin/audit', () => {
  beforeEach(() => {
    mockLogs = [
      {
        id: 'log-1',
        action: 'user.update',
        targetType: 'user',
        targetId: 'user-123',
        changes: { name: { old: 'Old Name', new: 'New Name' } },
        metadata: null,
        ipAddress: '192.168.1.1',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        adminUser: {
          id: 'admin-123',
          email: 'admin@example.com',
          name: 'Admin User',
        },
      },
      {
        id: 'log-2',
        action: 'user.delete',
        targetType: 'user',
        targetId: 'user-456',
        changes: null,
        metadata: { reason: 'Requested by user' },
        ipAddress: '192.168.1.2',
        createdAt: new Date('2024-01-14T10:00:00Z'),
        adminUser: {
          id: 'admin-456',
          email: 'other-admin@example.com',
          name: 'Other Admin',
        },
      },
    ];
    mockTotal = 2;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/admin/audit');
      const request = new NextRequest(url);

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createRequest({ token: 'invalid' });

      const response = await GET(request);

      expect(response.status).toBe(401);
    });
  });

  describe('authorization', () => {
    test('returns 403 for non-admin users', async () => {
      const request = createRequest({ token: 'user-token' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
      expect(data.error.message).toBe('Admin access required');
    });
  });

  describe('list audit logs', () => {
    test('returns paginated audit logs', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toBeDefined();
      expect(Array.isArray(data.data.items)).toBe(true);
    });

    test('returns default pagination values', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(1);
      expect(data.data.limit).toBe(20);
      expect(data.data.totalPages).toBeDefined();
    });

    test('respects custom pagination parameters', async () => {
      const request = createRequest({ page: 2, limit: 10 });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(2);
      expect(data.data.limit).toBe(10);
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
  });

  describe('filtering', () => {
    test('accepts action filter parameter', async () => {
      const request = createRequest({ action: 'user.update' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('accepts targetType filter parameter', async () => {
      const request = createRequest({ targetType: 'user' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('accepts adminId filter parameter with valid UUID', async () => {
      const request = createRequest({ adminId: '123e4567-e89b-12d3-a456-426614174000' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('accepts startDate filter parameter', async () => {
      const request = createRequest({ startDate: '2024-01-01' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('accepts endDate filter parameter', async () => {
      const request = createRequest({ endDate: '2024-12-31' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('accepts combined filters', async () => {
      const request = createRequest({
        action: 'user.update',
        targetType: 'user',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('response shape', () => {
    test('returns correct top-level structure', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('items');
      expect(data.data).toHaveProperty('total');
      expect(data.data).toHaveProperty('page');
      expect(data.data).toHaveProperty('limit');
      expect(data.data).toHaveProperty('totalPages');
    });

    test('audit log items have correct fields', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      if (data.data.items.length > 0) {
        const log = data.data.items[0];
        expect(log).toHaveProperty('id');
        expect(log).toHaveProperty('action');
        expect(log).toHaveProperty('targetType');
        expect(log).toHaveProperty('targetId');
        expect(log).toHaveProperty('createdAt');
        expect(log).toHaveProperty('adminUser');
      }
    });

    test('adminUser has correct fields when present', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      if (data.data.items.length > 0 && data.data.items[0].adminUser) {
        const adminUser = data.data.items[0].adminUser;
        expect(adminUser).toHaveProperty('id');
        expect(adminUser).toHaveProperty('email');
        expect(adminUser).toHaveProperty('name');
      }
    });
  });
});

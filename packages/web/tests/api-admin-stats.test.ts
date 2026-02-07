import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state for counts
let mockCounts = {
  totalUsers: 100,
  totalSessions: 500,
  totalAssistants: 50,
  totalMessages: 2000,
  totalAssistantMessages: 300,
  newUsersToday: 5,
  newUsersWeek: 25,
  newUsersMonth: 80,
  sessionsToday: 20,
  messagesWeek: 150,
};

// Create a thenable object that behaves like a Promise
function createThenable(fields: any) {
  const fieldKey = Object.keys(fields)[0] as keyof typeof mockCounts;

  const thenable = {
    where: (condition: any) => {
      return Promise.resolve([{ [fieldKey]: mockCounts[fieldKey] }]);
    },
    then: (resolve: any, reject?: any) => {
      return Promise.resolve([{ [fieldKey]: mockCounts[fieldKey] }]).then(resolve, reject);
    },
    catch: (reject: any) => {
      return Promise.resolve([{ [fieldKey]: mockCounts[fieldKey] }]).catch(reject);
    },
  };
  return thenable;
}

// Mock database
mock.module('@/db', () => ({
  db: {
    select: (fields: any) => ({
      from: (table: any) => createThenable(fields),
    }),
  },
  schema: createSchemaMock(),
}));

// Mock db schema
mock.module('@/db/schema', () => createSchemaMock({
  users: 'users',
  sessions: 'sessions',
  assistants: 'assistants',
  messages: 'messages',
  assistantMessages: 'assistantMessages',
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
  sql: () => 'sql',
  gte: (field: any, value: any) => ({ gte: [field, value] }),
}));

const { GET } = await import('../src/app/api/v1/admin/stats/route');

function createRequest(options: { token?: string } = {}): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/admin/stats');

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer admin-token';
  }

  return new NextRequest(url, { headers });
}

describe('GET /api/v1/admin/stats', () => {
  beforeEach(() => {
    mockCounts = {
      totalUsers: 100,
      totalSessions: 500,
      totalAssistants: 50,
      totalMessages: 2000,
      totalAssistantMessages: 300,
      newUsersToday: 5,
      newUsersWeek: 25,
      newUsersMonth: 80,
      sessionsToday: 20,
      messagesWeek: 150,
    };
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/admin/stats');
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

  describe('stats retrieval', () => {
    test('returns all system statistics', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.totals).toBeDefined();
      expect(data.data.recent).toBeDefined();
      expect(data.data.generated).toBeDefined();
    });

    test('returns correct total counts', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.totals.users).toBe(100);
      expect(data.data.totals.sessions).toBe(500);
      expect(data.data.totals.assistants).toBe(50);
      expect(data.data.totals.messages).toBe(2000);
      expect(data.data.totals.assistantMessages).toBe(300);
    });

    test('returns correct recent activity counts', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.recent.newUsersToday).toBe(5);
      expect(data.data.recent.newUsersWeek).toBe(25);
      expect(data.data.recent.newUsersMonth).toBe(80);
      expect(data.data.recent.sessionsToday).toBe(20);
      expect(data.data.recent.messagesWeek).toBe(150);
    });

    test('includes generated timestamp in ISO format', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.generated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('returns zero counts when database is empty', async () => {
      mockCounts = {
        totalUsers: 0,
        totalSessions: 0,
        totalAssistants: 0,
        totalMessages: 0,
        totalAssistantMessages: 0,
        newUsersToday: 0,
        newUsersWeek: 0,
        newUsersMonth: 0,
        sessionsToday: 0,
        messagesWeek: 0,
      };
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.totals.users).toBe(0);
      expect(data.data.totals.sessions).toBe(0);
      expect(data.data.recent.newUsersToday).toBe(0);
    });

    test('returns high counts for large datasets', async () => {
      mockCounts = {
        totalUsers: 1000000,
        totalSessions: 5000000,
        totalAssistants: 100000,
        totalMessages: 50000000,
        totalAssistantMessages: 10000000,
        newUsersToday: 1000,
        newUsersWeek: 5000,
        newUsersMonth: 15000,
        sessionsToday: 10000,
        messagesWeek: 100000,
      };
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.totals.users).toBe(1000000);
      expect(data.data.totals.messages).toBe(50000000);
    });
  });

});


afterAll(() => {
  mock.restore();
});

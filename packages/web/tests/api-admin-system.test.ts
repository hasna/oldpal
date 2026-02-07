import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state
let mockDbLatency = 5;
let mockDbError: string | null = null;
let mockActiveSessionsLastHour = 10;
let mockActiveUsersLastHour = 5;

// Create mock db select chain
function createSelectChain(result: any) {
  return {
    from: () => ({
      limit: () => Promise.resolve(result),
      where: () => Promise.resolve(result),
    }),
  };
}

// Mock database
mock.module('@/db', () => ({
  db: {
    select: (fields: any) => {
      if (mockDbError) {
        return {
          from: () => ({
            limit: () => Promise.reject(new Error(mockDbError)),
            where: () => Promise.reject(new Error(mockDbError)),
          }),
        };
      }
      // Check what field is being selected
      const fieldKeys = Object.keys(fields);
      if (fieldKeys.includes('count')) {
        return createSelectChain([{ count: mockActiveSessionsLastHour }]);
      }
      return createSelectChain([{ count: mockActiveSessionsLastHour }]);
    },
  },
  schema: createSchemaMock(),
}));

// Mock db schema
mock.module('@/db/schema', () => createSchemaMock({
  users: { userId: 'userId' },
  sessions: { updatedAt: 'updatedAt', userId: 'userId' },
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
  count: () => ({ count: 'count' }),
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({ sql: strings, values }),
  gte: (field: any, value: any) => ({ gte: [field, value] }),
  and: (...args: any[]) => ({ and: args }),
  eq: (field: any, value: any) => ({ eq: [field, value] }),
}));

const { GET } = await import('../src/app/api/v1/admin/system/route');

function createRequest(options: { token?: string; check?: string } = {}): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/admin/system');
  if (options.check) {
    url.searchParams.set('check', options.check);
  }

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer admin-token';
  }

  return new NextRequest(url, { headers });
}

describe('GET /api/v1/admin/system', () => {
  beforeEach(() => {
    mockDbLatency = 5;
    mockDbError = null;
    mockActiveSessionsLastHour = 10;
    mockActiveUsersLastHour = 5;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/admin/system');
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

  describe('full system status (no check param)', () => {
    test('returns healthy status when database is connected', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('healthy');
    });

    test('returns database connection details', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.database).toBeDefined();
      expect(data.data.database.status).toBe('connected');
      expect(typeof data.data.database.latencyMs).toBe('number');
    });

    test('returns activity metrics', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.activity).toBeDefined();
      expect(typeof data.data.activity.activeSessionsLastHour).toBe('number');
      expect(typeof data.data.activity.activeUsersLastHour).toBe('number');
    });

    test('includes timestamp in ISO format', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.timestamp).toBeDefined();
      expect(data.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('health check (check=health)', () => {
    test('returns healthy status with database latency', async () => {
      const request = createRequest({ check: 'health' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('healthy');
      expect(data.data.database.status).toBe('connected');
      expect(typeof data.data.database.latencyMs).toBe('number');
    });

    test('includes timestamp', async () => {
      const request = createRequest({ check: 'health' });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.timestamp).toBeDefined();
    });
  });

  describe('active sessions check (check=active-sessions)', () => {
    test('returns active session counts', async () => {
      const request = createRequest({ check: 'active-sessions' });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.activeSessions).toBeDefined();
      expect(typeof data.data.activeSessions.lastHour).toBe('number');
      expect(typeof data.data.activeSessions.lastDay).toBe('number');
    });

    test('includes timestamp', async () => {
      const request = createRequest({ check: 'active-sessions' });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.timestamp).toBeDefined();
    });
  });

  describe('response shape validation', () => {
    test('full status has correct top-level fields', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('status');
      expect(data.data).toHaveProperty('database');
      expect(data.data).toHaveProperty('activity');
      expect(data.data).toHaveProperty('timestamp');
    });

    test('database object has correct fields', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.database).toHaveProperty('status');
      expect(data.data.database).toHaveProperty('latencyMs');
    });

    test('activity object has correct fields', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.activity).toHaveProperty('activeSessionsLastHour');
      expect(data.data.activity).toHaveProperty('activeUsersLastHour');
    });
  });
});

afterAll(() => {
  mock.restore();
});

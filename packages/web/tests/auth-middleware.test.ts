import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createJwtMock } from './helpers/mock-auth-jwt';

type AuthenticatedRequest = import('../src/lib/auth/middleware').AuthenticatedRequest;

let mockDbUser: { isActive: boolean; role: 'user' | 'admin' } | null = null;
const tokenPayloads = new Map<string, any>();
let tokenCounter = 0;

mock.module('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => mockDbUser,
      },
    },
  },
  schema: createSchemaMock(),
}));

mock.module('@/db/schema', () => createSchemaMock({
  users: { id: 'id', isActive: 'isActive', role: 'role' },
}));

mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
}));

mock.module('@/lib/auth/jwt', () => createJwtMock({
  createAccessToken: async (payload: any) => {
    const token = `token-${++tokenCounter}`;
    tokenPayloads.set(token, payload);
    return token;
  },
  verifyAccessToken: async (token: string) => tokenPayloads.get(token) ?? null,
}));

const {
  withAuth,
  withAdminAuth,
  getAuthUser,
  clearUserStatusCache,
} = await import('../src/lib/auth/middleware');
const { createAccessToken } = await import('../src/lib/auth/jwt');

beforeEach(() => {
  tokenPayloads.clear();
  tokenCounter = 0;
  mockDbUser = { isActive: true, role: 'user' };
  clearUserStatusCache();
});

afterAll(() => {
  mock.restore();
});

describe('auth middleware', () => {
  describe('getAuthUser', () => {
    test('returns user payload for valid token', async () => {
      const token = await createAccessToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      const request = new NextRequest('http://localhost/test', {
        headers: { Authorization: `Bearer ${token}` },
      });

      const user = await getAuthUser(request);

      expect(user).not.toBeNull();
      expect(user!.userId).toBe('user-123');
      expect(user!.email).toBe('test@example.com');
      expect(user!.role).toBe('user');
    });

    test('returns null for missing Authorization header', async () => {
      const request = new NextRequest('http://localhost/test');
      const user = await getAuthUser(request);
      expect(user).toBeNull();
    });

    test('returns null for invalid token format', async () => {
      const request = new NextRequest('http://localhost/test', {
        headers: { Authorization: 'invalid-format' },
      });
      const user = await getAuthUser(request);
      expect(user).toBeNull();
    });

    test('returns null for invalid token', async () => {
      const request = new NextRequest('http://localhost/test', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      const user = await getAuthUser(request);
      expect(user).toBeNull();
    });

    test('returns null for empty Bearer token', async () => {
      const request = new NextRequest('http://localhost/test', {
        headers: { Authorization: 'Bearer ' },
      });
      const user = await getAuthUser(request);
      expect(user).toBeNull();
    });
  });

  describe('withAuth', () => {
    test('calls handler with authenticated request', async () => {
      const token = await createAccessToken({
        userId: 'user-456',
        email: 'test@example.com',
        role: 'user',
      });

      let receivedUser: any = null;
      const handler = async (req: AuthenticatedRequest) => {
        receivedUser = req.user;
        return NextResponse.json({ success: true });
      };

      const wrappedHandler = withAuth(handler);
      const request = new NextRequest('http://localhost/test', {
        headers: { Authorization: `Bearer ${token}` },
      });

      const response = await wrappedHandler(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(receivedUser.userId).toBe('user-456');
    });

    test('returns 401 for missing token', async () => {
      const handler = async () => {
        return NextResponse.json({ success: true });
      };

      const wrappedHandler = withAuth(handler);
      const request = new NextRequest('http://localhost/test');

      const response = await wrappedHandler(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('UNAUTHORIZED');
    });

    test('returns 401 for invalid token', async () => {
      const handler = async () => {
        return NextResponse.json({ success: true });
      };

      const wrappedHandler = withAuth(handler);
      const request = new NextRequest('http://localhost/test', {
        headers: { Authorization: 'Bearer invalid-token' },
      });

      const response = await wrappedHandler(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error.message).toContain('Invalid or expired');
    });
  });

  describe('withAdminAuth', () => {
    test('allows admin users', async () => {
      mockDbUser = { isActive: true, role: 'admin' };
      const token = await createAccessToken({
        userId: 'admin-1',
        email: 'admin@example.com',
        role: 'admin',
      });

      let called = false;
      const handler = async () => {
        called = true;
        return NextResponse.json({ success: true });
      };

      const wrappedHandler = withAdminAuth(handler);
      const request = new NextRequest('http://localhost/test', {
        headers: { Authorization: `Bearer ${token}` },
      });

      const response = await wrappedHandler(request);
      const data = await response.json();

      expect(called).toBe(true);
      expect(data.success).toBe(true);
    });

    test('returns 403 for non-admin users', async () => {
      mockDbUser = { isActive: true, role: 'user' };
      const token = await createAccessToken({
        userId: 'user-1',
        email: 'user@example.com',
        role: 'user',
      });

      const handler = async () => {
        return NextResponse.json({ success: true });
      };

      const wrappedHandler = withAdminAuth(handler);
      const request = new NextRequest('http://localhost/test', {
        headers: { Authorization: `Bearer ${token}` },
      });

      const response = await wrappedHandler(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
      expect(data.error.message).toContain('Admin access required');
    });

    test('returns 401 for missing token (checked before admin check)', async () => {
      const handler = async () => {
        return NextResponse.json({ success: true });
      };

      const wrappedHandler = withAdminAuth(handler);
      const request = new NextRequest('http://localhost/test');

      const response = await wrappedHandler(request);

      expect(response.status).toBe(401);
    });
  });
});

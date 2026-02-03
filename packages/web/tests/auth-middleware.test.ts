import { describe, expect, test } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import {
  withAuth,
  withAdminAuth,
  getAuthUser,
  type AuthenticatedRequest,
} from '../src/lib/auth/middleware';
import { createAccessToken } from '../src/lib/auth/jwt';

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
      const handler = async (req: AuthenticatedRequest) => {
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
      const handler = async (req: AuthenticatedRequest) => {
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
      const token = await createAccessToken({
        userId: 'admin-1',
        email: 'admin@example.com',
        role: 'admin',
      });

      let called = false;
      const handler = async (req: AuthenticatedRequest) => {
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
      const token = await createAccessToken({
        userId: 'user-1',
        email: 'user@example.com',
        role: 'user',
      });

      const handler = async (req: AuthenticatedRequest) => {
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
      const handler = async (req: AuthenticatedRequest) => {
        return NextResponse.json({ success: true });
      };

      const wrappedHandler = withAdminAuth(handler);
      const request = new NextRequest('http://localhost/test');

      const response = await wrappedHandler(request);

      expect(response.status).toBe(401);
    });
  });
});

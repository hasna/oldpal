import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state
let mockFoundUser: any = null;
let mockTokenPayload: { userId: string; email: string; role: string } | null = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => mockFoundUser,
      },
    },
  },
  schema: createSchemaMock(),
}));

// Mock db schema
mock.module('@/db/schema', () => createSchemaMock({
  users: 'users',
}));

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => createAuthMiddlewareMock({
  withAuth: (handler: any) => async (request: NextRequest) => {
    if (!mockTokenPayload) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' } },
        { status: 401 }
      );
    }
    (request as any).user = mockTokenPayload;
    return handler(request);
  },
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
}));

const { GET } = await import('../src/app/api/v1/auth/me/route');

function createRequest(): NextRequest {
  return new NextRequest('http://localhost/api/v1/auth/me', {
    method: 'GET',
    headers: {
      Authorization: 'Bearer mock-token',
    },
  });
}

describe('auth/me API route', () => {
  beforeEach(() => {
    mockFoundUser = null;
    mockTokenPayload = null;
  });

  test('returns 200 with user data', async () => {
    mockTokenPayload = { userId: 'user-id', email: 'test@example.com', role: 'user' };
    mockFoundUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      avatarUrl: null,
      emailVerified: false,
      createdAt: new Date('2024-01-01'),
    };

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.id).toBe('user-id');
    expect(data.data.email).toBe('test@example.com');
    expect(data.data.name).toBe('Test User');
    expect(data.data.role).toBe('user');
  });

  test('returns createdAt as ISO string', async () => {
    mockTokenPayload = { userId: 'user-id', email: 'test@example.com', role: 'user' };
    mockFoundUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test',
      role: 'user',
      avatarUrl: null,
      emailVerified: false,
      createdAt: new Date('2024-06-15T10:30:00Z'),
    };

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(data.data.createdAt).toBe('2024-06-15T10:30:00.000Z');
  });

  test('returns admin role for admin users', async () => {
    mockTokenPayload = { userId: 'admin-id', email: 'admin@example.com', role: 'admin' };
    mockFoundUser = {
      id: 'admin-id',
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      avatarUrl: 'https://example.com/avatar.png',
      emailVerified: true,
      createdAt: new Date(),
    };

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(data.data.role).toBe('admin');
    expect(data.data.avatarUrl).toBe('https://example.com/avatar.png');
    expect(data.data.emailVerified).toBe(true);
  });

  test('returns 401 when not authenticated', async () => {
    mockTokenPayload = null; // No auth

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  test('returns 404 when user not found in database', async () => {
    mockTokenPayload = { userId: 'deleted-user', email: 'deleted@example.com', role: 'user' };
    mockFoundUser = null; // User deleted from DB

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
    expect(data.error.message).toBe('User not found');
  });

  test('does not include password hash in response', async () => {
    mockTokenPayload = { userId: 'user-id', email: 'test@example.com', role: 'user' };
    mockFoundUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test',
      role: 'user',
      avatarUrl: null,
      emailVerified: false,
      createdAt: new Date(),
      passwordHash: 'secret-hash', // This should not appear in response
    };

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(data.data.passwordHash).toBeUndefined();
    expect(data.data.password).toBeUndefined();
  });

  test('includes all expected user fields', async () => {
    mockTokenPayload = { userId: 'user-id', email: 'test@example.com', role: 'user' };
    mockFoundUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      avatarUrl: 'https://example.com/avatar.png',
      emailVerified: true,
      createdAt: new Date(),
    };

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect('id' in data.data).toBe(true);
    expect('email' in data.data).toBe(true);
    expect('name' in data.data).toBe(true);
    expect('role' in data.data).toBe(true);
    expect('avatarUrl' in data.data).toBe(true);
    expect('emailVerified' in data.data).toBe(true);
    expect('createdAt' in data.data).toBe(true);
  });
});

afterAll(() => {
  mock.restore();
});

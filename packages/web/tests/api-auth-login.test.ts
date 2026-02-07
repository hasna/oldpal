import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createCryptoMock } from './helpers/mock-crypto';
import { createJwtMock } from './helpers/mock-auth-jwt';
import { createPasswordMock } from './helpers/mock-auth-password';

// Mock state
let mockFoundUser: any = null;
let mockInsertedRefreshToken: any = null;
let setRefreshTokenValue: string | null = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => mockFoundUser,
      },
    },
    insert: (table: any) => ({
      values: (data: any) => {
        if (table === 'refreshTokens') {
          mockInsertedRefreshToken = data;
        }
        return { returning: () => [data] };
      },
    }),
  },
  schema: createSchemaMock(),
}));

// Mock db schema
mock.module('@/db/schema', () => createSchemaMock({
  users: 'users',
  refreshTokens: 'refreshTokens',
}));

// Mock password utilities
mock.module('@/lib/auth/password', () => createPasswordMock());

// Mock JWT utilities
mock.module('@/lib/auth/jwt', () => createJwtMock({
  createAccessToken: async () => 'mock-access-token',
  createRefreshToken: async () => 'mock-refresh-token',
  getRefreshTokenExpiry: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
}));

// Mock refresh token cookie helper
mock.module('@/lib/auth/cookies', () => ({
  setRefreshTokenCookie: (response: Response, token: string) => {
    setRefreshTokenValue = token;
    response.headers.set('set-cookie', `refresh_token=${token}`);
    return response;
  },
}));

// Mock rate limiting
mock.module('@/lib/rate-limit', () => ({
  checkRateLimit: () => null,
  RateLimitPresets: { login: 'login' },
}));

// Mock login audit logging
mock.module('@/lib/auth/login-logger', () => ({
  logLoginAttempt: async () => {},
}));

// Mock user agent parser
mock.module('@/lib/auth/user-agent-parser', () => ({
  parseUserAgent: () => ({ device: 'Device', browser: 'Browser', os: 'OS' }),
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
}));

// Mock crypto
mock.module('crypto', () => createCryptoMock({
  randomUUID: () => 'test-uuid-1234',
}));

const { POST } = await import('../src/app/api/v1/auth/login/route');

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('login API route', () => {
  beforeEach(() => {
    mockFoundUser = null;
    mockInsertedRefreshToken = null;
    setRefreshTokenValue = null;
  });

  test('returns 200 on successful login', async () => {
    mockFoundUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      avatarUrl: null,
      passwordHash: await createPasswordMock().hashPassword('password123'),
    };

    const request = createRequest({
      email: 'test@example.com',
      password: 'password123',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.user.id).toBe('user-id');
    expect(data.data.user.email).toBe('test@example.com');
    expect(data.data.accessToken).toBe('mock-access-token');
    expect(setRefreshTokenValue).toBe('mock-refresh-token');
  });

  test('stores refresh token in database on successful login', async () => {
    mockFoundUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      avatarUrl: null,
      passwordHash: await createPasswordMock().hashPassword('password123'),
    };

    const request = createRequest({
      email: 'test@example.com',
      password: 'password123',
    });

    await POST(request);

    expect(mockInsertedRefreshToken).toBeDefined();
    expect(mockInsertedRefreshToken.userId).toBe('user-id');
    expect(mockInsertedRefreshToken.family).toBe('test-uuid-1234');
  });

  test('returns 401 if user not found', async () => {
    mockFoundUser = null;

    const request = createRequest({
      email: 'nonexistent@example.com',
      password: 'password123',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('UNAUTHORIZED');
    expect(data.error.message).toBe('Invalid email or password');
  });

  test('returns 401 if user has no password hash (OAuth user)', async () => {
    mockFoundUser = {
      id: 'user-id',
      email: 'oauth@example.com',
      name: 'OAuth User',
      role: 'user',
      avatarUrl: null,
      passwordHash: null, // OAuth users may not have password
    };

    const request = createRequest({
      email: 'oauth@example.com',
      password: 'password123',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.message).toBe('Invalid email or password');
  });

  test('returns 401 if password is incorrect', async () => {
    mockFoundUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      avatarUrl: null,
      passwordHash: await createPasswordMock().hashPassword('password123'),
    };

    const request = createRequest({
      email: 'test@example.com',
      password: 'wrongpassword',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.message).toBe('Invalid email or password');
  });

  test('looks up user with lowercased email', async () => {
    mockFoundUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      avatarUrl: null,
      passwordHash: await createPasswordMock().hashPassword('password123'),
    };

    const request = createRequest({
      email: 'TEST@EXAMPLE.COM',
      password: 'password123',
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
  });

  test('returns 422 for invalid email format', async () => {
    const request = createRequest({
      email: 'not-an-email',
      password: 'password123',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 422 for empty password', async () => {
    const request = createRequest({
      email: 'test@example.com',
      password: '',
    });

    const response = await POST(request);

    expect(response.status).toBe(422);
  });

  test('returns 422 for missing email', async () => {
    const request = createRequest({
      password: 'password123',
    });

    const response = await POST(request);

    expect(response.status).toBe(422);
  });

  test('returns 422 for missing password', async () => {
    const request = createRequest({
      email: 'test@example.com',
    });

    const response = await POST(request);

    expect(response.status).toBe(422);
  });

  test('user response does not include password hash', async () => {
    mockFoundUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      avatarUrl: null,
      passwordHash: await createPasswordMock().hashPassword('password123'),
    };

    const request = createRequest({
      email: 'test@example.com',
      password: 'password123',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.data.user.passwordHash).toBeUndefined();
    expect(data.data.user.password).toBeUndefined();
  });

  test('admin user login returns admin role', async () => {
    mockFoundUser = {
      id: 'admin-id',
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      avatarUrl: 'https://example.com/avatar.png',
      passwordHash: await createPasswordMock().hashPassword('adminpass'),
    };

    const request = createRequest({
      email: 'admin@example.com',
      password: 'adminpass',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.user.role).toBe('admin');
    expect(data.data.user.avatarUrl).toBe('https://example.com/avatar.png');
  });
});

afterAll(() => {
  mock.restore();
});

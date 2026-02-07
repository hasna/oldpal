import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createCryptoMock } from './helpers/mock-crypto';
import { createJwtMock } from './helpers/mock-auth-jwt';
import { createPasswordMock } from './helpers/mock-auth-password';

// Mock state
let mockExistingUser: any = null;
let mockInsertedUser: any = null;
let mockInsertedRefreshToken: any = null;
let requestCounter = 0;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => mockExistingUser,
      },
    },
    insert: (table: any) => ({
      values: (data: any) => {
        if (table === 'users') {
          mockInsertedUser = data;
          return {
            returning: () => [{
              id: 'new-user-id',
              email: data.email,
              name: data.name,
              role: data.role,
              avatarUrl: null,
              passwordHash: data.passwordHash,
            }],
          };
        }
        if (table === 'refreshTokens') {
          mockInsertedRefreshToken = data;
          return { returning: () => [data] };
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

// Mock drizzle-orm
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
}));

// Mock crypto
mock.module('crypto', () => createCryptoMock({
  randomUUID: () => '123e4567-e89b-12d3-a456-426614174000',
}));

const { POST } = await import('../src/app/api/v1/auth/register/route');

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/v1/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `192.168.110.${(requestCounter += 1)}`,
    },
    body: JSON.stringify(body),
  });
}

describe('register API route', () => {
  beforeEach(() => {
    mockExistingUser = null;
    mockInsertedUser = null;
    mockInsertedRefreshToken = null;
  });

  test('returns 201 on successful registration', async () => {
    const request = createRequest({
      email: 'newuser@example.com',
      password: 'password123',
      name: 'New User',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.data.user.email).toBe('newuser@example.com');
    expect(data.data.user.name).toBe('New User');
    expect(data.data.accessToken).toBe('mock-access-token');
    const cookie = response.headers.get('set-cookie') || '';
    expect(cookie).toContain('refresh_token=');
  });

  test('lowercases email before storing', async () => {
    const request = createRequest({
      email: 'USER@EXAMPLE.COM',
      password: 'password123',
      name: 'Test User',
    });

    await POST(request);

    expect(mockInsertedUser.email).toBe('user@example.com');
  });

  test('hashes password before storing', async () => {
    const request = createRequest({
      email: 'test@example.com',
      password: 'mySecretPassword',
      name: 'Test User',
    });

    await POST(request);

    expect(typeof mockInsertedUser.passwordHash).toBe('string');
    expect(mockInsertedUser.passwordHash).not.toBe('mySecretPassword');
    expect(mockInsertedUser.passwordHash.startsWith('$argon2')).toBe(true);
  });

  test('sets role to user for new registrations', async () => {
    const request = createRequest({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    });

    await POST(request);

    expect(mockInsertedUser.role).toBe('user');
  });

  test('stores refresh token in database', async () => {
    const request = createRequest({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    });

    await POST(request);

    expect(mockInsertedRefreshToken).toBeDefined();
    expect(mockInsertedRefreshToken.userId).toBe('new-user-id');
    expect(mockInsertedRefreshToken.family).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(mockInsertedRefreshToken.expiresAt).toBeInstanceOf(Date);
  });

  test('returns 409 if email already registered', async () => {
    mockExistingUser = {
      id: 'existing-user-id',
      email: 'existing@example.com',
    };

    const request = createRequest({
      email: 'existing@example.com',
      password: 'password123',
      name: 'New User',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('CONFLICT');
  });

  test('returns 422 for invalid email format', async () => {
    const request = createRequest({
      email: 'not-an-email',
      password: 'password123',
      name: 'Test User',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 422 for password too short', async () => {
    const request = createRequest({
      email: 'test@example.com',
      password: 'short',
      name: 'Test User',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
  });

  test('returns 422 for missing name', async () => {
    const request = createRequest({
      email: 'test@example.com',
      password: 'password123',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
  });

  test('returns 422 for empty name', async () => {
    const request = createRequest({
      email: 'test@example.com',
      password: 'password123',
      name: '',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
  });

  test('returns 422 for missing email', async () => {
    const request = createRequest({
      password: 'password123',
      name: 'Test User',
    });

    const response = await POST(request);

    expect(response.status).toBe(422);
  });

  test('returns 422 for missing password', async () => {
    const request = createRequest({
      email: 'test@example.com',
      name: 'Test User',
    });

    const response = await POST(request);

    expect(response.status).toBe(422);
  });

  test('user response does not include password hash', async () => {
    const request = createRequest({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.data.user.passwordHash).toBeUndefined();
    expect(data.data.user.password).toBeUndefined();
  });

  test('user response includes expected fields', async () => {
    const request = createRequest({
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    });

    const response = await POST(request);
    const data = await response.json();

    const { user } = data.data;
    expect(user.id).toBeDefined();
    expect(user.email).toBeDefined();
    expect(user.name).toBeDefined();
    expect(user.role).toBeDefined();
    expect('avatarUrl' in user).toBe(true);
  });
});

afterAll(() => {
  mock.restore();
});

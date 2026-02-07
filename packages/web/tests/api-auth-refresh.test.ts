import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createCryptoMock } from './helpers/mock-crypto';
import { createJwtMock } from './helpers/mock-auth-jwt';
import { createPasswordMock } from './helpers/mock-auth-password';

// Mock state
let mockTokenPayload: { userId: string; family: string } | null = null;
let mockStoredTokens: any[] = [];
let mockUser: any = null;
let mockRevokedFamily: string | null = null;
let mockRevokedTokenId: string | null = null;
let mockInsertedToken: any = null;
let mockRefreshToken: string | null = null;
let setRefreshTokenValue: string | null = null;
let requestCounter = 0;

// Track all update calls
let updateCalls: Array<{ value: any }> = [];

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      refreshTokens: {
        findMany: async () => mockStoredTokens,
      },
      users: {
        findFirst: async () => mockUser,
      },
    },
    update: (table: any) => ({
      set: (data: any) => ({
        where: (condition: any) => {
          updateCalls.push({ value: condition.value });
          // Check if it looks like a family (string without dashes typically) or an ID
          if (typeof condition.value === 'string') {
            if (condition.value.includes('token-family') || condition.value === 'token-family') {
              mockRevokedFamily = condition.value;
            } else {
              mockRevokedTokenId = condition.value;
            }
          }
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: any) => ({
      values: (data: any) => {
        mockInsertedToken = data;
        return Promise.resolve();
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

// Mock refresh token cookie helpers
mock.module('@/lib/auth/cookies', () => ({
  getRefreshTokenFromCookie: async () => mockRefreshToken,
  setRefreshTokenCookie: (response: Response, token: string) => {
    setRefreshTokenValue = token;
    response.headers.set('set-cookie', `refresh_token=${token}`);
    return response;
  },
}));

// Mock JWT utilities
mock.module('@/lib/auth/jwt', () => createJwtMock({
  verifyRefreshToken: async () => mockTokenPayload,
  createAccessToken: async () => 'new-access-token',
  createRefreshToken: async () => 'new-refresh-token',
  getRefreshTokenExpiry: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
}));

// Mock drizzle-orm - track the last eq value for each field type
let lastEqValue: any = null;
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => {
    lastEqValue = value;
    return { field, value, __eqValue: value };
  },
  and: (...args: any[]) => ({ and: args }),
  isNull: (field: any) => ({ isNull: field }),
  gt: (field: any, value: any) => ({ gt: field, value }),
}));

// Mock crypto
mock.module('crypto', () => createCryptoMock({
  randomUUID: () => '123e4567-e89b-12d3-a456-426614174000',
}));

const { POST } = await import('../src/app/api/v1/auth/refresh/route');

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/v1/auth/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `192.168.120.${(requestCounter += 1)}`,
    },
    body: JSON.stringify(body),
  });
}

async function hashToken(token: string) {
  return createPasswordMock().hashPassword(token);
}

describe('auth refresh API route', () => {
  beforeEach(() => {
    mockTokenPayload = null;
    mockStoredTokens = [];
    mockUser = null;
    mockRevokedFamily = null;
    mockRevokedTokenId = null;
    mockInsertedToken = null;
    mockRefreshToken = null;
    setRefreshTokenValue = null;
    updateCalls = [];
  });

  test('returns 200 with new tokens on successful refresh', async () => {
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    const refreshToken = 'valid-refresh-token';
    mockStoredTokens = [
      { id: 'token-id', tokenHash: await hashToken(refreshToken), family: 'token-family' },
    ];
    mockUser = {
      id: 'user-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
    };

    mockRefreshToken = refreshToken;
    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.accessToken).toBe('new-access-token');
    expect(setRefreshTokenValue).toBe('new-refresh-token');
  });

  test('revokes old token on successful refresh', async () => {
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    const refreshToken = 'valid-refresh-token';
    mockStoredTokens = [
      { id: 'old-token-id', tokenHash: await hashToken(refreshToken), family: 'token-family' },
    ];
    mockUser = {
      id: 'user-id',
      email: 'test@example.com',
      role: 'user',
    };

    mockRefreshToken = refreshToken;
    const request = createRequest({});

    await POST(request);

    expect(mockRevokedTokenId).toBe('old-token-id');
  });

  test('stores new refresh token with same family', async () => {
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    const refreshToken = 'valid-refresh-token';
    mockStoredTokens = [
      { id: 'token-id', tokenHash: await hashToken(refreshToken), family: 'token-family' },
    ];
    mockUser = {
      id: 'user-id',
      email: 'test@example.com',
      role: 'user',
    };

    mockRefreshToken = refreshToken;
    const request = createRequest({});

    await POST(request);

    expect(mockInsertedToken).toBeDefined();
    expect(mockInsertedToken.userId).toBe('user-id');
    expect(mockInsertedToken.family).toBe('token-family');
  });

  test('returns 401 for invalid refresh token JWT', async () => {
    mockTokenPayload = null; // Token verification fails

    mockRefreshToken = 'invalid-token';
    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error.message).toBe('Invalid refresh token');
  });

  test('returns 401 and revokes family on token reuse (no matching hash)', async () => {
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    mockStoredTokens = [
      { id: 'token-id', tokenHash: await hashToken('other-token'), family: 'token-family' },
    ];

    mockRefreshToken = 'reused-token';
    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.message).toBe('Token has been revoked');
    expect(mockRevokedFamily).toBe('token-family');
  });

  test('returns 401 when no stored tokens found', async () => {
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    mockStoredTokens = []; // No tokens in DB

    mockRefreshToken = 'valid-token';
    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.message).toBe('Token has been revoked');
  });

  test('returns 401 when user not found', async () => {
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    const refreshToken = 'valid-token';
    mockStoredTokens = [
      { id: 'token-id', tokenHash: await hashToken(refreshToken), family: 'token-family' },
    ];
    mockUser = null; // User deleted

    mockRefreshToken = refreshToken;
    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.message).toBe('User not found');
  });

  test('returns 401 for missing refresh token', async () => {
    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
  });

  test('returns 401 for empty refresh token', async () => {
    mockRefreshToken = '';
    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
  });
});

afterAll(() => {
  mock.restore();
});

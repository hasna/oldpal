import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createJwtMock } from './helpers/mock-auth-jwt';
import { createPasswordMock } from './helpers/mock-auth-password';

// Mock state
let mockTokenPayload: { userId: string; family: string } | null = null;
let mockFoundTokens: any[] = [];
let mockUpdatedFamily: string | null = null;
let mockRefreshToken: string | null = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      refreshTokens: {
        findMany: async () => mockFoundTokens,
      },
    },
    update: (table: any) => ({
      set: (data: any) => ({
        where: (condition: any) => {
          mockUpdatedFamily = condition.value;
          return Promise.resolve();
        },
      }),
    }),
  },
  schema: createSchemaMock(),
}));

// Mock db schema
mock.module('@/db/schema', () => createSchemaMock({
  refreshTokens: 'refreshTokens',
}));

// Mock password utilities (not used in logout but imported)
mock.module('@/lib/auth/password', () => createPasswordMock());

// Mock JWT utilities
mock.module('@/lib/auth/jwt', () => createJwtMock({
  verifyRefreshToken: async () => mockTokenPayload,
}));

// Mock cookies helper
mock.module('@/lib/auth/cookies', () => ({
  getRefreshTokenFromCookie: async () => mockRefreshToken,
  clearRefreshTokenCookie: (response: any) => response,
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
  and: (...args: any[]) => ({ and: args }),
  isNull: (field: any) => ({ isNull: field }),
}));

const { POST } = await import('../src/app/api/v1/auth/logout/route');

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/v1/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('logout API route', () => {
  beforeEach(() => {
    mockTokenPayload = null;
    mockFoundTokens = [];
    mockUpdatedFamily = null;
    mockRefreshToken = null;
  });

  test('returns 200 on successful logout', async () => {
    mockRefreshToken = 'valid-refresh-token';
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    mockFoundTokens = [
      { id: 'token-1', family: 'token-family', revokedAt: null },
    ];

    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.message).toBe('Logged out successfully');
  });

  test('revokes all tokens in the family', async () => {
    mockRefreshToken = 'valid-refresh-token';
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    mockFoundTokens = [
      { id: 'token-1', family: 'token-family', revokedAt: null },
      { id: 'token-2', family: 'token-family', revokedAt: null },
    ];

    const request = createRequest({});

    await POST(request);

    expect(mockUpdatedFamily).toBe('token-family');
  });

  test('returns 200 even if no tokens to revoke', async () => {
    mockRefreshToken = 'valid-refresh-token';
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    mockFoundTokens = []; // No tokens found

    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  test('returns 200 for invalid refresh token', async () => {
    mockRefreshToken = 'invalid-token';
    mockTokenPayload = null; // Token verification fails

    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  test('returns 200 for missing refresh token', async () => {
    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  test('does not update database if no active tokens', async () => {
    mockRefreshToken = 'valid-refresh-token';
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    mockFoundTokens = []; // No tokens

    const request = createRequest({});

    await POST(request);

    // Should not have called update since no tokens found
    expect(mockUpdatedFamily).toBeNull();
  });
});

afterAll(() => {
  mock.restore();
});

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest } from 'next/server';

// Mock state
let mockTokenPayload: { userId: string; family: string } | null = null;
let mockFoundTokens: any[] = [];
let mockUpdatedFamily: string | null = null;

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
}));

// Mock db schema
mock.module('@/db/schema', () => ({
  refreshTokens: 'refreshTokens',
}));

// Mock password utilities (not used in logout but imported)
mock.module('@/lib/auth/password', () => ({
  verifyPassword: async () => false,
}));

// Mock JWT utilities
mock.module('@/lib/auth/jwt', () => ({
  verifyRefreshToken: async () => mockTokenPayload,
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => ({
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
  });

  test('returns 200 on successful logout', async () => {
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    mockFoundTokens = [
      { id: 'token-1', family: 'token-family', revokedAt: null },
    ];

    const request = createRequest({
      refreshToken: 'valid-refresh-token',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.message).toBe('Logged out successfully');
  });

  test('revokes all tokens in the family', async () => {
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    mockFoundTokens = [
      { id: 'token-1', family: 'token-family', revokedAt: null },
      { id: 'token-2', family: 'token-family', revokedAt: null },
    ];

    const request = createRequest({
      refreshToken: 'valid-refresh-token',
    });

    await POST(request);

    expect(mockUpdatedFamily).toBe('token-family');
  });

  test('returns 200 even if no tokens to revoke', async () => {
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    mockFoundTokens = []; // No tokens found

    const request = createRequest({
      refreshToken: 'valid-refresh-token',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  test('returns 401 for invalid refresh token', async () => {
    mockTokenPayload = null; // Token verification fails

    const request = createRequest({
      refreshToken: 'invalid-token',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('UNAUTHORIZED');
    expect(data.error.message).toBe('Invalid refresh token');
  });

  test('returns 422 for missing refresh token', async () => {
    const request = createRequest({});

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 422 for empty refresh token', async () => {
    const request = createRequest({
      refreshToken: '',
    });

    const response = await POST(request);

    expect(response.status).toBe(422);
  });

  test('does not update database if no active tokens', async () => {
    mockTokenPayload = { userId: 'user-id', family: 'token-family' };
    mockFoundTokens = []; // No tokens

    const request = createRequest({
      refreshToken: 'valid-refresh-token',
    });

    await POST(request);

    // Should not have called update since no tokens found
    expect(mockUpdatedFamily).toBeNull();
  });
});

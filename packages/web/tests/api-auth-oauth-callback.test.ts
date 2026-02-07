import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createCryptoMock } from './helpers/mock-crypto';
import { createOAuthMock } from './helpers/mock-oauth';
import { createJwtMock } from './helpers/mock-auth-jwt';
import { createPasswordMock } from './helpers/mock-auth-password';

// Mock state
let mockGoogleUser: any = null;
let mockExistingUserByGoogleId: any = null;
let mockExistingUserByEmail: any = null;
let mockUpdatedUser: any = null;
let mockCreatedUser: any = null;
let mockInsertedToken: any = null;
let mockGetGoogleUserError: Error | null = null;

// Track update/insert calls
let updateSetData: any = null;
let insertValuesData: any = null;

// Track which query is being made
let queryCallCount = 0;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: async ({ where }: any) => {
          queryCallCount++;
          // First query is for googleId, second is for email
          if (queryCallCount === 1) {
            return mockExistingUserByGoogleId;
          }
          return mockExistingUserByEmail;
        },
      },
    },
    update: (table: any) => ({
      set: (data: any) => {
        updateSetData = data;
        return {
          where: (condition: any) => ({
            returning: () => [mockUpdatedUser],
          }),
        };
      },
    }),
    insert: (table: any) => {
      if (table === 'refreshTokens') {
        return {
          values: (data: any) => {
            mockInsertedToken = data;
            return Promise.resolve();
          },
        };
      }
      // users table
      return {
        values: (data: any) => {
          insertValuesData = data;
          return {
            returning: () => [mockCreatedUser],
          };
        },
      };
    },
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

// Mock OAuth utilities
mock.module('@/lib/auth/oauth', () => createOAuthMock({
  getGoogleUserInfo: async (code: string) => {
    if (mockGetGoogleUserError) {
      throw mockGetGoogleUserError;
    }
    return mockGoogleUser;
  },
}));

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
  randomUUID: () => 'test-uuid',
}));

const { GET } = await import('../src/app/api/v1/auth/oauth/google/callback/route');

function createCallbackRequest(
  params: { code?: string; state?: string; error?: string; error_description?: string } = {},
  cookies: { oauth_state?: string; oauth_code_verifier?: string } = {}
): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/auth/oauth/google/callback');
  if (params.code) url.searchParams.set('code', params.code);
  if (params.state) url.searchParams.set('state', params.state);
  if (params.error) url.searchParams.set('error', params.error);
  if (params.error_description) url.searchParams.set('error_description', params.error_description);

  // Set cookies via Cookie header
  const headers: Record<string, string> = {};
  const cookiePairs: string[] = [];
  if (cookies.oauth_state) {
    cookiePairs.push(`oauth_state=${cookies.oauth_state}`);
  }
  if (cookies.oauth_code_verifier) {
    cookiePairs.push(`oauth_code_verifier=${cookies.oauth_code_verifier}`);
  }
  if (cookiePairs.length > 0) {
    headers['Cookie'] = cookiePairs.join('; ');
  }

  return new NextRequest(url, { headers });
}

// Helper to check if URL contains text (handles both + and %20 encoding)
function locationContainsText(location: string | null, text: string): boolean {
  if (!location) return false;
  const decoded = decodeURIComponent(location.replace(/\+/g, ' '));
  return decoded.includes(text);
}

describe('OAuth Google callback route', () => {
  beforeEach(() => {
    mockGoogleUser = {
      id: 'google-123',
      email: 'test@gmail.com',
      verified_email: true,
      name: 'Test User',
      picture: 'https://example.com/photo.jpg',
    };
    mockExistingUserByGoogleId = null;
    mockExistingUserByEmail = null;
    mockUpdatedUser = null;
    mockCreatedUser = {
      id: 'user-new',
      email: 'test@gmail.com',
      name: 'Test User',
      role: 'user',
      avatarUrl: 'https://example.com/photo.jpg',
      googleId: 'google-123',
    };
    mockInsertedToken = null;
    mockGetGoogleUserError = null;
    updateSetData = null;
    insertValuesData = null;
    queryCallCount = 0;
  });

  describe('error handling', () => {
    test('redirects with error when OAuth returns error', async () => {
      const request = createCallbackRequest({ error: 'access_denied' });

      const response = await GET(request);

      expect(response.status).toBe(307); // redirect
      const location = response.headers.get('location');
      expect(location).toContain('/login');
      expect(location).toContain('error=access_denied');
    });

    test('uses error_description when available', async () => {
      const request = createCallbackRequest({
        error: 'access_denied',
        error_description: 'User denied access',
      });

      const response = await GET(request);

      const location = response.headers.get('location');
      expect(locationContainsText(location, 'User denied access')).toBe(true);
    });

    test('redirects with error when no code provided', async () => {
      const request = createCallbackRequest({});

      const response = await GET(request);

      const location = response.headers.get('location');
      expect(location).toContain('/login');
      expect(locationContainsText(location, 'No authorization code provided')).toBe(true);
    });

    test('redirects with error when state is missing', async () => {
      const request = createCallbackRequest(
        { code: 'auth-code', state: 'test-state' },
        {} // no oauth_state cookie
      );

      const response = await GET(request);

      const location = response.headers.get('location');
      expect(location).toContain('/login');
      expect(locationContainsText(location, 'Invalid state parameter')).toBe(true);
    });

    test('redirects with error when state does not match', async () => {
      const request = createCallbackRequest(
        { code: 'auth-code', state: 'state-1' },
        { oauth_state: 'state-2' }
      );

      const response = await GET(request);

      const location = response.headers.get('location');
      expect(location).toContain('/login');
      expect(locationContainsText(location, 'Invalid state parameter')).toBe(true);
    });

    test('redirects with error when getGoogleUserInfo fails', async () => {
      mockGetGoogleUserError = new Error('Token exchange failed');
      const request = createCallbackRequest(
        { code: 'invalid-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      const response = await GET(request);

      const location = response.headers.get('location');
      expect(location).toContain('/login');
      expect(locationContainsText(location, 'Authentication failed')).toBe(true);
    });
  });

  describe('existing user by Google ID', () => {
    test('creates tokens for existing user found by Google ID', async () => {
      mockExistingUserByGoogleId = {
        id: 'existing-user',
        email: 'test@gmail.com',
        name: 'Test User',
        role: 'user',
        googleId: 'google-123',
      };

      const request = createCallbackRequest(
        { code: 'auth-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toContain('/auth/callback');
    });

    test('stores refresh token in database', async () => {
      mockExistingUserByGoogleId = {
        id: 'existing-user',
        email: 'test@gmail.com',
        role: 'user',
      };

      const request = createCallbackRequest(
        { code: 'auth-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      await GET(request);

      expect(mockInsertedToken).toBeDefined();
      expect(mockInsertedToken.userId).toBe('existing-user');
      expect(typeof mockInsertedToken.tokenHash).toBe('string');
      expect(mockInsertedToken.tokenHash.startsWith('$argon2')).toBe(true);
      expect(mockInsertedToken.family).toBe('test-uuid');
    });
  });

  describe('account linking', () => {
    test('links Google account to existing user with same email', async () => {
      mockExistingUserByGoogleId = null; // First query returns null
      mockExistingUserByEmail = {
        id: 'existing-user',
        email: 'test@gmail.com',
        name: 'Existing User',
        role: 'user',
        avatarUrl: null,
        googleId: null,
      };
      mockUpdatedUser = {
        id: 'existing-user',
        email: 'test@gmail.com',
        name: 'Existing User',
        role: 'user',
        avatarUrl: 'https://example.com/photo.jpg',
        googleId: 'google-123',
      };

      const request = createCallbackRequest(
        { code: 'auth-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(updateSetData).not.toBeNull();
      expect(updateSetData.googleId).toBe('google-123');
      expect(updateSetData.emailVerified).toBe(true);
    });

    test('preserves existing avatar when linking', async () => {
      mockExistingUserByGoogleId = null;
      mockExistingUserByEmail = {
        id: 'existing-user',
        email: 'test@gmail.com',
        avatarUrl: 'https://existing-avatar.com/photo.jpg',
        role: 'user',
      };
      mockUpdatedUser = {
        id: 'existing-user',
        email: 'test@gmail.com',
        avatarUrl: 'https://existing-avatar.com/photo.jpg',
        role: 'user',
      };

      const request = createCallbackRequest(
        { code: 'auth-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      await GET(request);

      // Should use existing avatar, not Google's
      expect(updateSetData).not.toBeNull();
      expect(updateSetData.avatarUrl).toBe('https://existing-avatar.com/photo.jpg');
    });

    test('uses Google avatar when user has none', async () => {
      mockExistingUserByGoogleId = null;
      mockExistingUserByEmail = {
        id: 'existing-user',
        email: 'test@gmail.com',
        avatarUrl: null,
        role: 'user',
      };
      mockUpdatedUser = {
        id: 'existing-user',
        email: 'test@gmail.com',
        avatarUrl: 'https://example.com/photo.jpg',
        role: 'user',
      };

      const request = createCallbackRequest(
        { code: 'auth-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      await GET(request);

      // Should use Google's avatar
      expect(updateSetData).not.toBeNull();
      expect(updateSetData.avatarUrl).toBe('https://example.com/photo.jpg');
    });
  });

  describe('new user creation', () => {
    test('creates new user when no existing user found', async () => {
      mockExistingUserByGoogleId = null;
      mockExistingUserByEmail = null;

      const request = createCallbackRequest(
        { code: 'auth-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(insertValuesData).toBeDefined();
      expect(insertValuesData.email).toBe('test@gmail.com');
      expect(insertValuesData.emailVerified).toBe(true);
      expect(insertValuesData.name).toBe('Test User');
      expect(insertValuesData.avatarUrl).toBe('https://example.com/photo.jpg');
      expect(insertValuesData.googleId).toBe('google-123');
      expect(insertValuesData.role).toBe('user');
    });

    test('lowercases email when creating new user', async () => {
      mockExistingUserByGoogleId = null;
      mockExistingUserByEmail = null;
      mockGoogleUser.email = 'TEST@GMAIL.COM';

      const request = createCallbackRequest(
        { code: 'auth-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      await GET(request);

      expect(insertValuesData.email).toBe('test@gmail.com');
    });

    test('uses email_verified from Google', async () => {
      mockExistingUserByGoogleId = null;
      mockExistingUserByEmail = null;
      mockGoogleUser.verified_email = false;

      const request = createCallbackRequest(
        { code: 'auth-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      await GET(request);

      expect(insertValuesData.emailVerified).toBe(false);
    });
  });

  describe('token response', () => {
    test('redirects to /auth/callback with tokens', async () => {
      mockExistingUserByGoogleId = {
        id: 'user-123',
        email: 'test@gmail.com',
        role: 'user',
      };

      const request = createCallbackRequest(
        { code: 'auth-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toContain('/auth/callback');
    });

    test('clears oauth_state cookie', async () => {
      mockExistingUserByGoogleId = {
        id: 'user-123',
        email: 'test@gmail.com',
        role: 'user',
      };

      const request = createCallbackRequest(
        { code: 'auth-code', state: 'valid-state' },
        { oauth_state: 'valid-state', oauth_code_verifier: 'verifier' }
      );

      const response = await GET(request);

      // Check Set-Cookie header for deletion
      const setCookieHeader = response.headers.get('set-cookie');
      expect(setCookieHeader).toContain('oauth_state');
    });
  });
});

afterAll(() => {
  mock.restore();
});

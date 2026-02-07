import { describe, expect, test, beforeAll } from 'bun:test';

let jwt: typeof import('../src/lib/auth/jwt');

beforeAll(async () => {
  jwt = await import(`../src/lib/auth/jwt?test=${Date.now()}-${Math.random()}`);
});

// Note: The JWT module uses lazy secret initialization and caches secrets.
// Tests for production behavior (throwing on missing/default secrets) are
// validated at runtime when NODE_ENV=production. These tests run in development
// mode and verify the functional behavior of the JWT utilities.

describe('JWT utilities', () => {
  describe('jwt.createAccessToken', () => {
    test('creates a valid access token', async () => {
      const token = await jwt.createAccessToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });

    test('includes iat and exp claims', async () => {
      const token = await jwt.createAccessToken({
        userId: 'user-1',
        email: 'test@example.com',
        role: 'user',
      });

      const payload = await jwt.verifyAccessToken(token);
      expect(payload!.iat).toBeDefined();
      expect(payload!.exp).toBeDefined();
      expect(payload!.exp! > payload!.iat!).toBe(true); // exp is after iat
    });
  });

  describe('jwt.createRefreshToken', () => {
    test('creates a valid refresh token', async () => {
      const token = await jwt.createRefreshToken({
        userId: 'user-123',
        family: 'family-uuid',
      });

      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);
    });
  });

  describe('jwt.verifyAccessToken', () => {
    test('returns payload for valid token', async () => {
      const originalPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'admin' as const,
      };

      const token = await jwt.createAccessToken(originalPayload);
      const payload = await jwt.verifyAccessToken(token);

      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('user-123');
      expect(payload!.email).toBe('test@example.com');
      expect(payload!.role).toBe('admin');
    });

    test('returns null for invalid token', async () => {
      const payload = await jwt.verifyAccessToken('invalid-token');
      expect(payload).toBeNull();
    });

    test('returns null for malformed token', async () => {
      const payload = await jwt.verifyAccessToken('not.a.jwt');
      expect(payload).toBeNull();
    });

    test('returns null for empty string', async () => {
      const payload = await jwt.verifyAccessToken('');
      expect(payload).toBeNull();
    });

    test('returns null for refresh token (wrong secret)', async () => {
      const refreshToken = await jwt.createRefreshToken({
        userId: 'user-123',
        family: 'family-uuid',
      });

      // Access token verification should fail for refresh token
      const payload = await jwt.verifyAccessToken(refreshToken);
      expect(payload).toBeNull();
    });
  });

  describe('jwt.verifyRefreshToken', () => {
    test('returns payload for valid token', async () => {
      const originalPayload = {
        userId: 'user-123',
        family: 'family-uuid',
      };

      const token = await jwt.createRefreshToken(originalPayload);
      const payload = await jwt.verifyRefreshToken(token);

      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('user-123');
      expect(payload!.family).toBe('family-uuid');
    });

    test('returns null for invalid token', async () => {
      const payload = await jwt.verifyRefreshToken('invalid-token');
      expect(payload).toBeNull();
    });

    test('returns null for access token (wrong secret)', async () => {
      const accessToken = await jwt.createAccessToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      // Refresh token verification should fail for access token
      const payload = await jwt.verifyRefreshToken(accessToken);
      expect(payload).toBeNull();
    });
  });

  describe('jwt.getRefreshTokenExpiry', () => {
    test('returns date approximately 7 days in the future', () => {
      const before = Date.now();
      const expiry = jwt.getRefreshTokenExpiry();
      const after = Date.now();

      const sevenDays = 7 * 24 * 60 * 60 * 1000;

      expect(expiry instanceof Date).toBe(true);
      expect(expiry.getTime()).toBeGreaterThanOrEqual(before + sevenDays - 1000);
      expect(expiry.getTime()).toBeLessThanOrEqual(after + sevenDays + 1000);
    });

    test('returns valid Date object', () => {
      const expiry = jwt.getRefreshTokenExpiry();
      expect(isNaN(expiry.getTime())).toBe(false);
    });
  });

  describe('development mode defaults', () => {
    // These tests verify that the JWT functions work correctly in development mode
    // using the default secrets (which are automatically used when env vars are not set)

    test('tokens can be round-tripped in development mode', async () => {
      // Create an access token
      const accessToken = await jwt.createAccessToken({
        userId: 'dev-user',
        email: 'dev@example.com',
        role: 'user',
      });

      // Verify it works
      const accessPayload = await jwt.verifyAccessToken(accessToken);
      expect(accessPayload).not.toBeNull();
      expect(accessPayload!.userId).toBe('dev-user');

      // Create a refresh token
      const refreshToken = await jwt.createRefreshToken({
        userId: 'dev-user',
        family: 'dev-family',
      });

      // Verify it works
      const refreshPayload = await jwt.verifyRefreshToken(refreshToken);
      expect(refreshPayload).not.toBeNull();
      expect(refreshPayload!.userId).toBe('dev-user');
    });

    test('access and refresh tokens use different secrets', async () => {
      const accessToken = await jwt.createAccessToken({
        userId: 'test-user',
        email: 'test@example.com',
        role: 'user',
      });

      const refreshToken = await jwt.createRefreshToken({
        userId: 'test-user',
        family: 'test-family',
      });

      // Cross-verification should fail because they use different secrets
      expect(await jwt.verifyRefreshToken(accessToken)).toBeNull();
      expect(await jwt.verifyAccessToken(refreshToken)).toBeNull();
    });
  });

  describe('token payload preservation', () => {
    test('access token preserves all payload fields', async () => {
      const payload = {
        userId: 'user-abc123',
        email: 'payload-test@example.com',
        role: 'admin' as const,
      };

      const token = await jwt.createAccessToken(payload);
      const verified = await jwt.verifyAccessToken(token);

      expect(verified).not.toBeNull();
      expect(verified!.userId).toBe(payload.userId);
      expect(verified!.email).toBe(payload.email);
      expect(verified!.role).toBe(payload.role);
    });

    test('refresh token preserves all payload fields', async () => {
      const payload = {
        userId: 'user-xyz789',
        family: 'family-uuid-123',
      };

      const token = await jwt.createRefreshToken(payload);
      const verified = await jwt.verifyRefreshToken(token);

      expect(verified).not.toBeNull();
      expect(verified!.userId).toBe(payload.userId);
      expect(verified!.family).toBe(payload.family);
    });
  });

  describe('token security', () => {
    test('tampered token is rejected', async () => {
      const token = await jwt.createAccessToken({
        userId: 'secure-user',
        email: 'secure@example.com',
        role: 'user',
      });

      // Tamper with the payload (middle part of JWT)
      const parts = token.split('.');
      parts[1] = parts[1].slice(0, -1) + 'X'; // Modify last character
      const tamperedToken = parts.join('.');

      expect(await jwt.verifyAccessToken(tamperedToken)).toBeNull();
    });

    test('token with modified signature is rejected', async () => {
      const token = await jwt.createAccessToken({
        userId: 'secure-user',
        email: 'secure@example.com',
        role: 'user',
      });

      // Tamper with the signature (last part of JWT)
      const parts = token.split('.');
      parts[2] = 'invalid_signature_here';
      const tamperedToken = parts.join('.');

      expect(await jwt.verifyAccessToken(tamperedToken)).toBeNull();
    });
  });
});

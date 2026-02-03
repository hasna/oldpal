import { describe, expect, test } from 'bun:test';
import {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
} from '../src/lib/auth/jwt';

describe('JWT utilities', () => {
  describe('createAccessToken', () => {
    test('creates a valid access token', async () => {
      const token = await createAccessToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });

    test('includes iat and exp claims', async () => {
      const token = await createAccessToken({
        userId: 'user-1',
        email: 'test@example.com',
        role: 'user',
      });

      const payload = await verifyAccessToken(token);
      expect(payload!.iat).toBeDefined();
      expect(payload!.exp).toBeDefined();
      expect(payload!.exp! > payload!.iat!).toBe(true); // exp is after iat
    });
  });

  describe('createRefreshToken', () => {
    test('creates a valid refresh token', async () => {
      const token = await createRefreshToken({
        userId: 'user-123',
        family: 'family-uuid',
      });

      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);
    });
  });

  describe('verifyAccessToken', () => {
    test('returns payload for valid token', async () => {
      const originalPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'admin' as const,
      };

      const token = await createAccessToken(originalPayload);
      const payload = await verifyAccessToken(token);

      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('user-123');
      expect(payload!.email).toBe('test@example.com');
      expect(payload!.role).toBe('admin');
    });

    test('returns null for invalid token', async () => {
      const payload = await verifyAccessToken('invalid-token');
      expect(payload).toBeNull();
    });

    test('returns null for malformed token', async () => {
      const payload = await verifyAccessToken('not.a.jwt');
      expect(payload).toBeNull();
    });

    test('returns null for empty string', async () => {
      const payload = await verifyAccessToken('');
      expect(payload).toBeNull();
    });

    test('returns null for refresh token (wrong secret)', async () => {
      const refreshToken = await createRefreshToken({
        userId: 'user-123',
        family: 'family-uuid',
      });

      // Access token verification should fail for refresh token
      const payload = await verifyAccessToken(refreshToken);
      expect(payload).toBeNull();
    });
  });

  describe('verifyRefreshToken', () => {
    test('returns payload for valid token', async () => {
      const originalPayload = {
        userId: 'user-123',
        family: 'family-uuid',
      };

      const token = await createRefreshToken(originalPayload);
      const payload = await verifyRefreshToken(token);

      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('user-123');
      expect(payload!.family).toBe('family-uuid');
    });

    test('returns null for invalid token', async () => {
      const payload = await verifyRefreshToken('invalid-token');
      expect(payload).toBeNull();
    });

    test('returns null for access token (wrong secret)', async () => {
      const accessToken = await createAccessToken({
        userId: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });

      // Refresh token verification should fail for access token
      const payload = await verifyRefreshToken(accessToken);
      expect(payload).toBeNull();
    });
  });

  describe('getRefreshTokenExpiry', () => {
    test('returns date approximately 7 days in the future', () => {
      const before = Date.now();
      const expiry = getRefreshTokenExpiry();
      const after = Date.now();

      const sevenDays = 7 * 24 * 60 * 60 * 1000;

      expect(expiry instanceof Date).toBe(true);
      expect(expiry.getTime()).toBeGreaterThanOrEqual(before + sevenDays - 1000);
      expect(expiry.getTime()).toBeLessThanOrEqual(after + sevenDays + 1000);
    });

    test('returns valid Date object', () => {
      const expiry = getRefreshTokenExpiry();
      expect(isNaN(expiry.getTime())).toBe(false);
    });
  });
});

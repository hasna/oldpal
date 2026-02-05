import { describe, expect, test, beforeEach } from 'bun:test';
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  formatKeyForDisplay,
  extractKeyPrefix,
  isValidApiKeyFormat,
  constantTimeCompare,
  generateKeyLookupHash,
  checkRateLimit,
  getRateLimitStatus,
  clearRateLimit,
  isHmacSecretConfigured,
  validateApiKeyConfig,
  isApiKeyAuthEnabled,
} from '../src/lib/auth/api-key';

describe('API Key utilities', () => {
  describe('generateApiKey', () => {
    test('generates key with correct prefix', () => {
      const { fullKey } = generateApiKey();
      expect(fullKey.startsWith('sk_live_')).toBe(true);
    });

    test('generates key with sufficient length', () => {
      const { fullKey } = generateApiKey();
      expect(fullKey.length).toBeGreaterThanOrEqual(20);
    });

    test('generates unique keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const { fullKey } = generateApiKey();
        expect(keys.has(fullKey)).toBe(false);
        keys.add(fullKey);
      }
    });

    test('returns correct keyPrefix', () => {
      const { fullKey, keyPrefix } = generateApiKey();
      expect(fullKey.startsWith(keyPrefix)).toBe(true);
      expect(keyPrefix.length).toBe(12);
    });
  });

  describe('hashApiKey and verifyApiKey', () => {
    test('hashes and verifies API key correctly', async () => {
      const { fullKey } = generateApiKey();
      const hash = await hashApiKey(fullKey);

      expect(hash).not.toBe(fullKey);
      expect(await verifyApiKey(fullKey, hash)).toBe(true);
    });

    test('fails verification with wrong key', async () => {
      const { fullKey } = generateApiKey();
      const { fullKey: otherKey } = generateApiKey();
      const hash = await hashApiKey(fullKey);

      expect(await verifyApiKey(otherKey, hash)).toBe(false);
    });

    test('fails verification with invalid hash', async () => {
      const { fullKey } = generateApiKey();
      expect(await verifyApiKey(fullKey, 'invalid-hash')).toBe(false);
    });

    test('generates different hashes for same key', async () => {
      const { fullKey } = generateApiKey();
      const hash1 = await hashApiKey(fullKey);
      const hash2 = await hashApiKey(fullKey);

      // Argon2 uses random salts
      expect(hash1).not.toBe(hash2);

      // But both should verify
      expect(await verifyApiKey(fullKey, hash1)).toBe(true);
      expect(await verifyApiKey(fullKey, hash2)).toBe(true);
    });
  });

  describe('formatKeyForDisplay', () => {
    test('shows prefix and suffix for long keys', () => {
      const key = 'test_key_abcdefghijklmnopqrstuvwxyz';
      const displayed = formatKeyForDisplay(key);

      expect(displayed).toContain('test_key_abc');
      expect(displayed).toContain('...');
      expect(displayed).toContain('wxyz');
    });

    test('returns short keys unchanged', () => {
      const key = 'test_key_short';
      const displayed = formatKeyForDisplay(key);

      expect(displayed).toBe(key);
    });
  });

  describe('extractKeyPrefix', () => {
    test('extracts first 12 characters', () => {
      const { fullKey } = generateApiKey();
      const prefix = extractKeyPrefix(fullKey);

      expect(prefix.length).toBe(12);
      expect(fullKey.startsWith(prefix)).toBe(true);
    });
  });

  describe('isValidApiKeyFormat', () => {
    test('validates correct format', () => {
      const { fullKey } = generateApiKey();
      expect(isValidApiKeyFormat(fullKey)).toBe(true);
    });

    test('rejects keys without prefix', () => {
      expect(isValidApiKeyFormat('abcdefghijklmnopqrstuvwxyz')).toBe(false);
    });

    test('rejects keys that are too short', () => {
      expect(isValidApiKeyFormat('sk_live_abc')).toBe(false);
    });

    test('rejects empty string', () => {
      expect(isValidApiKeyFormat('')).toBe(false);
    });

    test('rejects keys with wrong prefix', () => {
      expect(isValidApiKeyFormat('sk_test_abcdefghijklmnop')).toBe(false);
    });
  });

  describe('constantTimeCompare', () => {
    test('returns true for equal strings', () => {
      expect(constantTimeCompare('hello', 'hello')).toBe(true);
    });

    test('returns false for different strings of same length', () => {
      expect(constantTimeCompare('hello', 'world')).toBe(false);
    });

    test('returns false for different length strings', () => {
      expect(constantTimeCompare('hello', 'hi')).toBe(false);
      expect(constantTimeCompare('hi', 'hello')).toBe(false);
    });

    test('returns true for empty strings', () => {
      expect(constantTimeCompare('', '')).toBe(true);
    });

    test('handles long strings', () => {
      const long1 = 'a'.repeat(1000);
      const long2 = 'a'.repeat(1000);
      expect(constantTimeCompare(long1, long2)).toBe(true);

      const long3 = 'a'.repeat(999) + 'b';
      expect(constantTimeCompare(long1, long3)).toBe(false);
    });
  });

  describe('generateKeyLookupHash', () => {
    test('generates consistent hash for same key', () => {
      const { fullKey } = generateApiKey();
      const hash1 = generateKeyLookupHash(fullKey);
      const hash2 = generateKeyLookupHash(fullKey);

      expect(hash1).toBe(hash2);
    });

    test('generates different hashes for different keys', () => {
      const { fullKey: key1 } = generateApiKey();
      const { fullKey: key2 } = generateApiKey();

      const hash1 = generateKeyLookupHash(key1);
      const hash2 = generateKeyLookupHash(key2);

      expect(hash1).not.toBe(hash2);
    });

    test('returns hex-encoded hash', () => {
      const { fullKey } = generateApiKey();
      const hash = generateKeyLookupHash(fullKey);

      // SHA-256 produces 64 hex characters
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });
  });

  describe('Rate limiting', () => {
    beforeEach(() => {
      // Clear rate limit state between tests
      clearRateLimit('test-ip-1');
      clearRateLimit('test-ip-2');
      clearRateLimit('test-ip-rate-limit');
    });

    test('allows requests within limit', () => {
      const key = 'test-ip-1';

      for (let i = 0; i < 10; i++) {
        expect(checkRateLimit(key)).toBe(true);
      }
    });

    test('blocks after exceeding limit', () => {
      const key = 'test-ip-rate-limit';

      // First 10 should be allowed
      for (let i = 0; i < 10; i++) {
        checkRateLimit(key);
      }

      // 11th should be blocked
      expect(checkRateLimit(key)).toBe(false);
    });

    test('getRateLimitStatus shows correct info', () => {
      const key = 'test-ip-2';

      // Initial state
      const initialStatus = getRateLimitStatus(key);
      expect(initialStatus.blocked).toBe(false);
      expect(initialStatus.attemptsRemaining).toBe(10);

      // After some attempts
      checkRateLimit(key);
      checkRateLimit(key);
      checkRateLimit(key);

      const afterAttempts = getRateLimitStatus(key);
      expect(afterAttempts.blocked).toBe(false);
      expect(afterAttempts.attemptsRemaining).toBe(7);
    });

    test('clearRateLimit resets limit', () => {
      const key = 'test-ip-1';

      // Use up some attempts
      for (let i = 0; i < 5; i++) {
        checkRateLimit(key);
      }

      // Clear and check
      clearRateLimit(key);
      const status = getRateLimitStatus(key);
      expect(status.attemptsRemaining).toBe(10);
    });

    test('separate rate limits for different keys', () => {
      const key1 = 'test-ip-1';
      const key2 = 'test-ip-2';

      // Use up key1's limit
      for (let i = 0; i < 10; i++) {
        checkRateLimit(key1);
      }

      // key2 should still work
      expect(checkRateLimit(key2)).toBe(true);

      // key1 should be blocked
      expect(checkRateLimit(key1)).toBe(false);
    });
  });

  describe('HMAC Configuration Validation', () => {
    // Note: These tests validate the configuration checking logic
    // The actual values depend on the current environment state

    describe('isHmacSecretConfigured', () => {
      test('returns false when using default key', () => {
        // In test environment, API_KEY_HMAC_SECRET is typically not set
        // or set to the default value, so this should return false
        const originalSecret = process.env.API_KEY_HMAC_SECRET;

        // Temporarily clear the env var
        delete process.env.API_KEY_HMAC_SECRET;
        expect(isHmacSecretConfigured()).toBe(false);

        // Restore
        if (originalSecret !== undefined) {
          process.env.API_KEY_HMAC_SECRET = originalSecret;
        }
      });

      test('returns false when set to default value', () => {
        const originalSecret = process.env.API_KEY_HMAC_SECRET;

        process.env.API_KEY_HMAC_SECRET = 'default-dev-hmac-key-change-in-production';
        expect(isHmacSecretConfigured()).toBe(false);

        // Restore
        if (originalSecret !== undefined) {
          process.env.API_KEY_HMAC_SECRET = originalSecret;
        } else {
          delete process.env.API_KEY_HMAC_SECRET;
        }
      });

      test('returns false when secret is too short', () => {
        const originalSecret = process.env.API_KEY_HMAC_SECRET;

        process.env.API_KEY_HMAC_SECRET = 'short-key'; // Less than 32 chars
        expect(isHmacSecretConfigured()).toBe(false);

        // Restore
        if (originalSecret !== undefined) {
          process.env.API_KEY_HMAC_SECRET = originalSecret;
        } else {
          delete process.env.API_KEY_HMAC_SECRET;
        }
      });

      test('returns true when properly configured', () => {
        const originalSecret = process.env.API_KEY_HMAC_SECRET;

        // Set a proper 32+ character secret
        process.env.API_KEY_HMAC_SECRET = 'a-very-secure-secret-that-is-at-least-32-characters-long';
        expect(isHmacSecretConfigured()).toBe(true);

        // Restore
        if (originalSecret !== undefined) {
          process.env.API_KEY_HMAC_SECRET = originalSecret;
        } else {
          delete process.env.API_KEY_HMAC_SECRET;
        }
      });
    });

    describe('validateApiKeyConfig', () => {
      test('returns valid true with warning in development without proper secret', () => {
        const originalSecret = process.env.API_KEY_HMAC_SECRET;
        const originalEnv = process.env.NODE_ENV;

        // Simulate development mode without proper secret
        delete process.env.API_KEY_HMAC_SECRET;
        process.env.NODE_ENV = 'development';

        const result = validateApiKeyConfig();
        expect(result.valid).toBe(true);
        expect(result.warning).toBeDefined();
        expect(result.warning).toContain('Using default HMAC key');

        // Restore
        if (originalSecret !== undefined) {
          process.env.API_KEY_HMAC_SECRET = originalSecret;
        }
        process.env.NODE_ENV = originalEnv;
      });

      test('returns valid false with error in production without proper secret', () => {
        const originalSecret = process.env.API_KEY_HMAC_SECRET;
        const originalEnv = process.env.NODE_ENV;

        // Simulate production mode without proper secret
        delete process.env.API_KEY_HMAC_SECRET;
        process.env.NODE_ENV = 'production';

        const result = validateApiKeyConfig();
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('CRITICAL');
        expect(result.error).toContain('API_KEY_HMAC_SECRET');

        // Restore
        if (originalSecret !== undefined) {
          process.env.API_KEY_HMAC_SECRET = originalSecret;
        }
        process.env.NODE_ENV = originalEnv;
      });

      test('returns valid true without warning when properly configured', () => {
        const originalSecret = process.env.API_KEY_HMAC_SECRET;

        // Set a proper secret
        process.env.API_KEY_HMAC_SECRET = 'a-very-secure-secret-that-is-at-least-32-characters-long';

        const result = validateApiKeyConfig();
        expect(result.valid).toBe(true);
        expect(result.warning).toBeUndefined();
        expect(result.error).toBeUndefined();

        // Restore
        if (originalSecret !== undefined) {
          process.env.API_KEY_HMAC_SECRET = originalSecret;
        } else {
          delete process.env.API_KEY_HMAC_SECRET;
        }
      });
    });

    describe('isApiKeyAuthEnabled', () => {
      test('returns true in development even without proper secret', () => {
        const originalSecret = process.env.API_KEY_HMAC_SECRET;
        const originalEnv = process.env.NODE_ENV;

        delete process.env.API_KEY_HMAC_SECRET;
        process.env.NODE_ENV = 'development';

        expect(isApiKeyAuthEnabled()).toBe(true);

        // Restore
        if (originalSecret !== undefined) {
          process.env.API_KEY_HMAC_SECRET = originalSecret;
        }
        process.env.NODE_ENV = originalEnv;
      });

      test('returns false in production without proper secret', () => {
        const originalSecret = process.env.API_KEY_HMAC_SECRET;
        const originalEnv = process.env.NODE_ENV;

        delete process.env.API_KEY_HMAC_SECRET;
        process.env.NODE_ENV = 'production';

        expect(isApiKeyAuthEnabled()).toBe(false);

        // Restore
        if (originalSecret !== undefined) {
          process.env.API_KEY_HMAC_SECRET = originalSecret;
        }
        process.env.NODE_ENV = originalEnv;
      });

      test('returns true in production with proper secret', () => {
        const originalSecret = process.env.API_KEY_HMAC_SECRET;
        const originalEnv = process.env.NODE_ENV;

        process.env.API_KEY_HMAC_SECRET = 'a-very-secure-secret-that-is-at-least-32-characters-long';
        process.env.NODE_ENV = 'production';

        expect(isApiKeyAuthEnabled()).toBe(true);

        // Restore
        if (originalSecret !== undefined) {
          process.env.API_KEY_HMAC_SECRET = originalSecret;
        } else {
          delete process.env.API_KEY_HMAC_SECRET;
        }
        process.env.NODE_ENV = originalEnv;
      });
    });
  });
});

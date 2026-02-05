import { randomBytes, timingSafeEqual, createHmac } from 'crypto';
import { hash, verify } from '@node-rs/argon2';

const API_KEY_PREFIX = 'sk_live_';
const API_KEY_LENGTH = 32; // 32 bytes = 256 bits of entropy

// HMAC key for indexed lookups - MUST be set via environment variable in production
const DEFAULT_DEV_KEY = 'default-dev-hmac-key-change-in-production';
const HMAC_KEY = process.env.API_KEY_HMAC_SECRET || DEFAULT_DEV_KEY;

/**
 * Check if the HMAC secret is properly configured
 * Returns true if using a secure custom secret, false if using default
 */
export function isHmacSecretConfigured(): boolean {
  return process.env.API_KEY_HMAC_SECRET !== undefined &&
         process.env.API_KEY_HMAC_SECRET !== DEFAULT_DEV_KEY &&
         process.env.API_KEY_HMAC_SECRET.length >= 32;
}

/**
 * Check if we're running in production mode
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Validate API key HMAC configuration
 * Should be called at application startup
 *
 * @throws Error if in production without proper HMAC secret
 * @returns { valid: boolean; warning?: string }
 */
export function validateApiKeyConfig(): { valid: boolean; warning?: string; error?: string } {
  if (isHmacSecretConfigured()) {
    return { valid: true };
  }

  if (isProduction()) {
    return {
      valid: false,
      error: 'CRITICAL: API_KEY_HMAC_SECRET is not configured or using default value. ' +
             'API key authentication is disabled in production. ' +
             'Set API_KEY_HMAC_SECRET environment variable to a secure random string (minimum 32 characters).',
    };
  }

  // Development mode with default key - log warning but allow
  return {
    valid: true,
    warning: 'WARNING: Using default HMAC key for API key authentication. ' +
             'This is only acceptable for development. ' +
             'Set API_KEY_HMAC_SECRET environment variable before deploying to production.',
  };
}

// Log warning/error at module load time
const configValidation = validateApiKeyConfig();
if (configValidation.error) {
  console.error(`[API KEY AUTH] ${configValidation.error}`);
} else if (configValidation.warning) {
  console.warn(`[API KEY AUTH] ${configValidation.warning}`);
}

/**
 * Check if API key authentication is available
 * Disabled in production without proper HMAC configuration
 */
export function isApiKeyAuthEnabled(): boolean {
  return isHmacSecretConfigured() || !isProduction();
}

const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

// Base62 character set for URL-safe encoding
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Encode bytes to base62 string
 */
function toBase62(bytes: Buffer): string {
  let result = '';
  let value = BigInt('0x' + bytes.toString('hex'));

  while (value > 0n) {
    result = BASE62_CHARS[Number(value % 62n)] + result;
    value = value / 62n;
  }

  return result || '0';
}

/**
 * Generate a cryptographically secure API key
 * Format: sk_live_ + 32 random bytes (base62 encoded)
 * Returns both the full key (to show once) and the prefix (for storage)
 */
export function generateApiKey(): { fullKey: string; keyPrefix: string } {
  const randomPart = randomBytes(API_KEY_LENGTH);
  const encodedRandom = toBase62(randomPart);
  const fullKey = `${API_KEY_PREFIX}${encodedRandom}`;

  // Key prefix is the first 12 characters for display identification
  const keyPrefix = fullKey.substring(0, 12);

  return { fullKey, keyPrefix };
}

/**
 * Hash an API key using argon2 for secure storage
 */
export async function hashApiKey(key: string): Promise<string> {
  return hash(key, ARGON2_OPTIONS);
}

/**
 * Verify an API key against a stored hash
 */
export async function verifyApiKey(key: string, hashedKey: string): Promise<boolean> {
  try {
    return await verify(hashedKey, key);
  } catch {
    return false;
  }
}

/**
 * Format an API key for display (shows prefix + masked portion)
 * Example: sk_live_abc...xyz
 */
export function formatKeyForDisplay(fullKey: string): string {
  if (fullKey.length <= 16) {
    return fullKey;
  }

  const prefix = fullKey.substring(0, 12);
  const suffix = fullKey.substring(fullKey.length - 4);
  return `${prefix}...${suffix}`;
}

/**
 * Extract the prefix from a full API key
 */
export function extractKeyPrefix(fullKey: string): string {
  return fullKey.substring(0, 12);
}

/**
 * Validate API key format (fast check, not constant-time)
 * Use for early rejection before constant-time operations
 */
export function isValidApiKeyFormat(key: string): boolean {
  return key.startsWith(API_KEY_PREFIX) && key.length >= 20;
}

/**
 * Constant-time string comparison to prevent timing attacks
 * Returns true if strings are equal, false otherwise
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still compare against something to maintain constant time
    const dummy = Buffer.alloc(a.length, 0);
    timingSafeEqual(Buffer.from(a), dummy);
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Generate a lookup hash for indexed DB queries
 * This allows finding the key without iterating through all prefixes
 * Uses HMAC(prefix + full_key) for a unique, indexed lookup
 */
export function generateKeyLookupHash(fullKey: string): string {
  const keyPrefix = extractKeyPrefix(fullKey);
  return createHmac('sha256', HMAC_KEY)
    .update(`${keyPrefix}:${fullKey}`)
    .digest('hex');
}

/**
 * Rate limiting state for API key validation attempts
 * Maps IP address / key prefix to attempt info
 */
interface RateLimitEntry {
  attempts: number;
  windowStart: number;
  blockedUntil?: number;
}

const rateLimitState = new Map<string, RateLimitEntry>();

// Rate limit configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_ATTEMPTS_PER_WINDOW = 10; // Max attempts per window
const BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minute block after exceeding limit

/**
 * Check if a rate limit key (IP or prefix) is currently blocked
 * Returns true if allowed, false if rate limited
 */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitState.get(key);

  if (!entry) {
    rateLimitState.set(key, {
      attempts: 1,
      windowStart: now,
    });
    return true;
  }

  // Check if blocked
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return false;
  }

  // Reset window if expired
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(key, {
      attempts: 1,
      windowStart: now,
    });
    return true;
  }

  // Increment and check limit
  entry.attempts++;

  if (entry.attempts > MAX_ATTEMPTS_PER_WINDOW) {
    entry.blockedUntil = now + BLOCK_DURATION_MS;
    return false;
  }

  return true;
}

/**
 * Get rate limit status for a key
 */
export function getRateLimitStatus(key: string): { blocked: boolean; attemptsRemaining: number; blockedUntil?: number } {
  const entry = rateLimitState.get(key);
  const now = Date.now();

  if (!entry) {
    return { blocked: false, attemptsRemaining: MAX_ATTEMPTS_PER_WINDOW };
  }

  if (entry.blockedUntil && now < entry.blockedUntil) {
    return { blocked: true, attemptsRemaining: 0, blockedUntil: entry.blockedUntil };
  }

  // Reset if window expired
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    return { blocked: false, attemptsRemaining: MAX_ATTEMPTS_PER_WINDOW };
  }

  return {
    blocked: false,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS_PER_WINDOW - entry.attempts),
  };
}

/**
 * Clear rate limit state for a key (e.g., after successful auth)
 */
export function clearRateLimit(key: string): void {
  rateLimitState.delete(key);
}

// Periodic cleanup of expired rate limit entries (every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitState.entries()) {
      // Remove entries that have expired and are not blocked
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS && (!entry.blockedUntil || now > entry.blockedUntil)) {
        rateLimitState.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

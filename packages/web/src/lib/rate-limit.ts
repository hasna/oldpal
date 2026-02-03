import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from './api/response';

/**
 * Simple in-memory rate limiter with sliding window.
 * For production multi-instance deployments, replace with Redis-based solution.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting
// Key format: `${identifier}:${endpoint}`
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpiredEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window size in seconds */
  windowSec: number;
  /** Optional identifier function (defaults to IP) */
  keyGenerator?: (request: NextRequest) => string;
}

// Preset configurations for common use cases
export const RateLimitPresets = {
  // Strict: 5 requests per minute (auth endpoints)
  auth: { limit: 5, windowSec: 60 },
  // Login specifically: 10 attempts per 15 minutes
  login: { limit: 10, windowSec: 15 * 60 },
  // Standard API: 60 requests per minute
  api: { limit: 60, windowSec: 60 },
  // Chat/streaming: 30 requests per minute
  chat: { limit: 30, windowSec: 60 },
  // Relaxed: 120 requests per minute
  relaxed: { limit: 120, windowSec: 60 },
} as const;

/**
 * Get client IP from request headers
 */
function getClientIp(request: NextRequest): string {
  // Check various headers that proxies/load balancers set
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;

  // Cloudflare
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) return cfConnectingIp;

  // Fallback to a default (will group all requests without IP info)
  return 'unknown';
}

/**
 * Check if a request should be rate limited.
 * Returns null if allowed, or a response if rate limited.
 */
export function checkRateLimit(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig
): NextResponse | null {
  cleanupExpiredEntries();

  const identifier = config.keyGenerator
    ? config.keyGenerator(request)
    : getClientIp(request);
  const key = `${identifier}:${endpoint}`;
  const now = Date.now();
  const windowMs = config.windowSec * 1000;

  let entry = rateLimitStore.get(key);

  if (!entry || entry.resetTime < now) {
    // Start a new window
    entry = {
      count: 1,
      resetTime: now + windowMs,
    };
    rateLimitStore.set(key, entry);
    return null; // Allowed
  }

  // Within window, increment count
  entry.count++;

  if (entry.count > config.limit) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);

    const response = NextResponse.json(
      {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
      },
      { status: 429 }
    );

    response.headers.set('Retry-After', String(retryAfter));
    response.headers.set('X-RateLimit-Limit', String(config.limit));
    response.headers.set('X-RateLimit-Remaining', '0');
    response.headers.set('X-RateLimit-Reset', String(entry.resetTime));

    return response;
  }

  // Allowed
  return null;
}

/**
 * Higher-order function to create a rate-limited route handler.
 */
export function withRateLimit<T>(
  handler: (request: NextRequest, context?: T) => Promise<NextResponse>,
  endpoint: string,
  config: RateLimitConfig
) {
  return async (request: NextRequest, context?: T): Promise<NextResponse> => {
    const rateLimitResponse = checkRateLimit(request, endpoint, config);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
    return handler(request, context);
  };
}

/**
 * Create a rate limiter for use with user ID instead of IP.
 * Useful for authenticated endpoints where you want per-user limits.
 */
export function createUserRateLimiter(userId: string, endpoint: string, config: RateLimitConfig): NextResponse | null {
  cleanupExpiredEntries();

  const key = `user:${userId}:${endpoint}`;
  const now = Date.now();
  const windowMs = config.windowSec * 1000;

  let entry = rateLimitStore.get(key);

  if (!entry || entry.resetTime < now) {
    entry = {
      count: 1,
      resetTime: now + windowMs,
    };
    rateLimitStore.set(key, entry);
    return null;
  }

  entry.count++;

  if (entry.count > config.limit) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);

    const response = NextResponse.json(
      {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
      },
      { status: 429 }
    );

    response.headers.set('Retry-After', String(retryAfter));
    response.headers.set('X-RateLimit-Limit', String(config.limit));
    response.headers.set('X-RateLimit-Remaining', '0');
    response.headers.set('X-RateLimit-Reset', String(entry.resetTime));

    return response;
  }

  return null;
}

/**
 * Get current rate limit status for an identifier/endpoint.
 * Useful for adding rate limit headers to successful responses.
 */
export function getRateLimitStatus(
  request: NextRequest,
  endpoint: string,
  config: RateLimitConfig
): { remaining: number; reset: number; limit: number } {
  const identifier = config.keyGenerator
    ? config.keyGenerator(request)
    : getClientIp(request);
  const key = `${identifier}:${endpoint}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetTime < now) {
    return {
      remaining: config.limit,
      reset: now + config.windowSec * 1000,
      limit: config.limit,
    };
  }

  return {
    remaining: Math.max(0, config.limit - entry.count),
    reset: entry.resetTime,
    limit: config.limit,
  };
}

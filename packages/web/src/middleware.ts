import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, RateLimitPresets, type RateLimitConfig } from '@/lib/rate-limit';

/**
 * Request size limits by route pattern (in bytes)
 * These limits are enforced at the middleware level before request parsing
 */
const BODY_SIZE_LIMITS: Record<string, number> = {
  // Auth routes - small payloads
  '/api/v1/auth/': 10 * 1024, // 10KB
  // Chat routes - larger for messages with context
  '/api/v1/chat': 150 * 1024, // 150KB
  // Messages routes
  '/api/v1/messages': 100 * 1024, // 100KB
  // Upload route - larger limit (actual file size checked separately)
  '/api/v1/upload': 10 * 1024 * 1024, // 10MB
  // Billing webhooks - Stripe payloads can be large
  '/api/v1/billing/webhooks': 1 * 1024 * 1024, // 1MB
  // Default for other API routes
  'default': 100 * 1024, // 100KB
};

/**
 * Rate limit configurations by route pattern
 * More specific patterns take precedence
 */
const RATE_LIMIT_ROUTES: Array<{
  pattern: RegExp;
  config: RateLimitConfig;
  endpoint: string;
}> = [
  // Auth routes - strict limits
  { pattern: /^\/api\/v1\/auth\/login$/, config: RateLimitPresets.login, endpoint: 'auth/login' },
  { pattern: /^\/api\/v1\/auth\/register$/, config: RateLimitPresets.auth, endpoint: 'auth/register' },
  { pattern: /^\/api\/v1\/auth\/refresh$/, config: RateLimitPresets.api, endpoint: 'auth/refresh' },
  { pattern: /^\/api\/v1\/auth\//, config: RateLimitPresets.auth, endpoint: 'auth' },

  // Chat routes - moderate limits (streaming can be resource intensive)
  { pattern: /^\/api\/v1\/chat/, config: RateLimitPresets.chat, endpoint: 'chat' },

  // Search routes - moderate limits
  { pattern: /^\/api\/v1\/search\//, config: RateLimitPresets.api, endpoint: 'search' },

  // Admin routes - relaxed for admin users
  { pattern: /^\/api\/v1\/admin\//, config: RateLimitPresets.relaxed, endpoint: 'admin' },

  // Export route - strict (resource intensive)
  { pattern: /^\/api\/v1\/export$/, config: { limit: 10, windowSec: 60 }, endpoint: 'export' },

  // Upload route - moderate (disk writes)
  { pattern: /^\/api\/v1\/upload$/, config: { limit: 30, windowSec: 60 }, endpoint: 'upload' },

  // Billing webhooks - no rate limit (from Stripe)
  { pattern: /^\/api\/v1\/billing\/webhooks/, config: { limit: 1000, windowSec: 60 }, endpoint: 'webhooks' },

  // Standard API routes
  { pattern: /^\/api\/v1\//, config: RateLimitPresets.api, endpoint: 'api' },
];

/**
 * Get the body size limit for a given path
 */
function getBodySizeLimit(path: string): number {
  // Check specific patterns first
  for (const [pattern, limit] of Object.entries(BODY_SIZE_LIMITS)) {
    if (pattern !== 'default' && path.startsWith(pattern)) {
      return limit;
    }
  }
  return BODY_SIZE_LIMITS['default'];
}

/**
 * Get rate limit config for a given path
 */
function getRateLimitConfig(path: string): { config: RateLimitConfig; endpoint: string } | null {
  for (const { pattern, config, endpoint } of RATE_LIMIT_ROUTES) {
    if (pattern.test(path)) {
      return { config, endpoint };
    }
  }
  return null;
}

/**
 * Create a rate limit exceeded response
 */
function rateLimitResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
    },
    {
      status: 429,
      headers: {
        'Retry-After': '60',
      },
    }
  );
}

/**
 * Create a payload too large response
 */
function payloadTooLargeResponse(limit: number): NextResponse {
  const limitKB = Math.round(limit / 1024);
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request body too large. Maximum size is ${limitKB}KB.`,
      },
    },
    { status: 413 }
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip rate limiting and body size checks for certain paths
  const skipPaths = [
    '/api/v1/health',
    '/api/v1/billing/webhooks', // Stripe webhooks have their own verification
  ];

  if (skipPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check Content-Length header for body size limits
  // Note: This is a preliminary check; actual body size is verified during parsing
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const bodySize = parseInt(contentLength, 10);
    const limit = getBodySizeLimit(pathname);

    if (!isNaN(bodySize) && bodySize > limit) {
      return payloadTooLargeResponse(limit);
    }
  }

  // Apply rate limiting
  const rateLimitInfo = getRateLimitConfig(pathname);
  if (rateLimitInfo) {
    const response = checkRateLimit(request, rateLimitInfo.endpoint, rateLimitInfo.config);
    if (response) {
      return response;
    }
  }

  return NextResponse.next();
}

/**
 * Configure which routes the middleware runs on
 * We only want it on API routes for now
 */
export const config = {
  matcher: [
    // Match all API routes
    '/api/:path*',
  ],
};

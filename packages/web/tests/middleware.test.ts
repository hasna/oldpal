import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Track rate limit calls for verification
let rateLimitCalls: Array<{ endpoint: string; config: any }> = [];
let shouldRateLimit = false;

// Mock the rate-limit module
mock.module('@/lib/rate-limit', () => ({
  checkRateLimit: (request: NextRequest, endpoint: string, config: any) => {
    rateLimitCalls.push({ endpoint, config });
    if (shouldRateLimit) {
      return NextResponse.json(
        { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
        { status: 429 }
      );
    }
    return null;
  },
  RateLimitPresets: {
    auth: { limit: 5, windowSec: 60 },
    login: { limit: 10, windowSec: 900 },
    api: { limit: 60, windowSec: 60 },
    chat: { limit: 30, windowSec: 60 },
    relaxed: { limit: 120, windowSec: 60 },
  },
}));

const { middleware } = await import('../src/middleware');

function createRequest(
  path: string,
  options: {
    method?: string;
    contentLength?: number;
    ip?: string;
  } = {}
): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.contentLength !== undefined) {
    headers['Content-Length'] = String(options.contentLength);
  }

  if (options.ip) {
    headers['x-forwarded-for'] = options.ip;
  }

  return new NextRequest(`http://localhost${path}`, {
    method: options.method || 'GET',
    headers,
  });
}

describe('middleware', () => {
  beforeEach(() => {
    rateLimitCalls = [];
    shouldRateLimit = false;
  });

  describe('body size limits', () => {
    test('allows requests within auth route size limit (10KB)', async () => {
      const request = createRequest('/api/v1/auth/login', {
        method: 'POST',
        contentLength: 5 * 1024, // 5KB
      });

      const response = await middleware(request);
      expect(response.status).not.toBe(413);
    });

    test('rejects requests exceeding auth route size limit', async () => {
      const request = createRequest('/api/v1/auth/login', {
        method: 'POST',
        contentLength: 15 * 1024, // 15KB exceeds 10KB limit
      });

      const response = await middleware(request);
      expect(response.status).toBe(413);

      const data = await response.json();
      expect(data.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    test('allows larger requests for chat route (150KB limit)', async () => {
      const request = createRequest('/api/v1/chat', {
        method: 'POST',
        contentLength: 100 * 1024, // 100KB
      });

      const response = await middleware(request);
      expect(response.status).not.toBe(413);
    });

    test('rejects oversized chat requests', async () => {
      const request = createRequest('/api/v1/chat', {
        method: 'POST',
        contentLength: 200 * 1024, // 200KB exceeds 150KB limit
      });

      const response = await middleware(request);
      expect(response.status).toBe(413);
    });

    test('allows large upload requests (10MB limit)', async () => {
      const request = createRequest('/api/v1/upload', {
        method: 'POST',
        contentLength: 5 * 1024 * 1024, // 5MB
      });

      const response = await middleware(request);
      expect(response.status).not.toBe(413);
    });

    test('uses default limit (100KB) for unspecified routes', async () => {
      const request = createRequest('/api/v1/agents', {
        method: 'POST',
        contentLength: 150 * 1024, // 150KB exceeds 100KB default
      });

      const response = await middleware(request);
      expect(response.status).toBe(413);
    });
  });

  describe('rate limiting', () => {
    test('applies login rate limit to login endpoint', async () => {
      const request = createRequest('/api/v1/auth/login', { method: 'POST' });
      await middleware(request);

      expect(rateLimitCalls.length).toBe(1);
      expect(rateLimitCalls[0].endpoint).toBe('auth/login');
      expect(rateLimitCalls[0].config.limit).toBe(10); // login preset
    });

    test('applies auth rate limit to register endpoint', async () => {
      const request = createRequest('/api/v1/auth/register', { method: 'POST' });
      await middleware(request);

      expect(rateLimitCalls.length).toBe(1);
      expect(rateLimitCalls[0].endpoint).toBe('auth/register');
      expect(rateLimitCalls[0].config.limit).toBe(5); // auth preset
    });

    test('applies chat rate limit to chat endpoint', async () => {
      const request = createRequest('/api/v1/chat', { method: 'POST' });
      await middleware(request);

      expect(rateLimitCalls.length).toBe(1);
      expect(rateLimitCalls[0].endpoint).toBe('chat');
      expect(rateLimitCalls[0].config.limit).toBe(30); // chat preset
    });

    test('applies api rate limit to general API endpoints', async () => {
      const request = createRequest('/api/v1/agents', { method: 'GET' });
      await middleware(request);

      expect(rateLimitCalls.length).toBe(1);
      expect(rateLimitCalls[0].endpoint).toBe('api');
      expect(rateLimitCalls[0].config.limit).toBe(60); // api preset
    });

    test('applies relaxed rate limit to admin endpoints', async () => {
      const request = createRequest('/api/v1/admin/users', { method: 'GET' });
      await middleware(request);

      expect(rateLimitCalls.length).toBe(1);
      expect(rateLimitCalls[0].endpoint).toBe('admin');
      expect(rateLimitCalls[0].config.limit).toBe(120); // relaxed preset
    });

    test('returns 429 when rate limited', async () => {
      shouldRateLimit = true;
      const request = createRequest('/api/v1/chat', { method: 'POST' });

      const response = await middleware(request);
      expect(response.status).toBe(429);
    });
  });

  describe('skip paths', () => {
    test('skips rate limiting for health endpoint', async () => {
      const request = createRequest('/api/health', { method: 'GET' });
      await middleware(request);

      expect(rateLimitCalls.length).toBe(0);
    });

    test('skips rate limiting for billing webhooks', async () => {
      const request = createRequest('/api/v1/billing/webhooks/stripe', { method: 'POST' });
      await middleware(request);

      expect(rateLimitCalls.length).toBe(0);
    });
  });

  describe('non-API routes', () => {
    test('does not apply middleware to non-API routes', async () => {
      const request = createRequest('/dashboard', { method: 'GET' });
      const response = await middleware(request);

      expect(rateLimitCalls.length).toBe(0);
      expect(response.status).not.toBe(429);
      expect(response.status).not.toBe(413);
    });
  });

  describe('request without content-length', () => {
    test('allows GET requests without content-length', async () => {
      const request = createRequest('/api/v1/agents', { method: 'GET' });
      const response = await middleware(request);

      expect(response.status).not.toBe(413);
    });
  });

  describe('error response format', () => {
    test('payload too large response includes size limit', async () => {
      const request = createRequest('/api/v1/auth/login', {
        method: 'POST',
        contentLength: 20 * 1024, // Exceeds 10KB limit
      });

      const response = await middleware(request);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(data.error.message).toContain('10KB'); // Should mention the limit
    });
  });
});

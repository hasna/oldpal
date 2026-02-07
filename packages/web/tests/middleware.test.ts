import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { RateLimitPresets } from '../src/lib/rate-limit';

const { middleware } = await import('../src/middleware');

let ipCounter = 0;
const nextIp = () => `10.0.0.${(ipCounter += 1)}`;

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

  headers['x-forwarded-for'] = options.ip || nextIp();

  return new NextRequest(`http://localhost${path}`, {
    method: options.method || 'GET',
    headers,
  });
}

describe('middleware', () => {

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
      const request = createRequest('/api/v1/assistants', {
        method: 'POST',
        contentLength: 150 * 1024, // 150KB exceeds 100KB default
      });

      const response = await middleware(request);
      expect(response.status).toBe(413);
    });
  });

  describe('rate limiting', () => {
    test('applies login rate limit to login endpoint', async () => {
      const ip = nextIp();
      const limit = RateLimitPresets.login.limit;
      for (let i = 0; i < limit; i += 1) {
        const response = await middleware(createRequest('/api/v1/auth/login', { method: 'POST', ip }));
        expect(response.status).not.toBe(429);
      }
      const blocked = await middleware(createRequest('/api/v1/auth/login', { method: 'POST', ip }));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('X-RateLimit-Limit')).toBe(String(limit));
    });

    test('applies auth rate limit to register endpoint', async () => {
      const ip = nextIp();
      const limit = RateLimitPresets.auth.limit;
      for (let i = 0; i < limit; i += 1) {
        const response = await middleware(createRequest('/api/v1/auth/register', { method: 'POST', ip }));
        expect(response.status).not.toBe(429);
      }
      const blocked = await middleware(createRequest('/api/v1/auth/register', { method: 'POST', ip }));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('X-RateLimit-Limit')).toBe(String(limit));
    });

    test('applies chat rate limit to chat endpoint', async () => {
      const ip = nextIp();
      const limit = RateLimitPresets.chat.limit;
      for (let i = 0; i < limit; i += 1) {
        const response = await middleware(createRequest('/api/v1/chat', { method: 'POST', ip }));
        expect(response.status).not.toBe(429);
      }
      const blocked = await middleware(createRequest('/api/v1/chat', { method: 'POST', ip }));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('X-RateLimit-Limit')).toBe(String(limit));
    });

    test('applies api rate limit to general API endpoints', async () => {
      const ip = nextIp();
      const limit = RateLimitPresets.api.limit;
      for (let i = 0; i < limit; i += 1) {
        const response = await middleware(createRequest('/api/v1/assistants', { method: 'GET', ip }));
        expect(response.status).not.toBe(429);
      }
      const blocked = await middleware(createRequest('/api/v1/assistants', { method: 'GET', ip }));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('X-RateLimit-Limit')).toBe(String(limit));
    });

    test('applies relaxed rate limit to admin endpoints', async () => {
      const ip = nextIp();
      const limit = RateLimitPresets.relaxed.limit;
      for (let i = 0; i < limit; i += 1) {
        const response = await middleware(createRequest('/api/v1/admin/users', { method: 'GET', ip }));
        expect(response.status).not.toBe(429);
      }
      const blocked = await middleware(createRequest('/api/v1/admin/users', { method: 'GET', ip }));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('X-RateLimit-Limit')).toBe(String(limit));
    });
  });

  describe('skip paths', () => {
    test('skips rate limiting for health endpoint', async () => {
      const ip = nextIp();
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => middleware(createRequest('/api/health', { method: 'GET', ip })))
      );
      for (const response of responses) {
        expect(response.status).not.toBe(429);
      }
    });

    test('skips rate limiting for billing webhooks', async () => {
      const ip = nextIp();
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => middleware(createRequest('/api/v1/billing/webhooks/stripe', { method: 'POST', ip })))
      );
      for (const response of responses) {
        expect(response.status).not.toBe(429);
      }
    });
  });

  describe('non-API routes', () => {
    test('does not apply middleware to non-API routes', async () => {
      const request = createRequest('/dashboard', { method: 'GET' });
      const response = await middleware(request);

      expect(response.status).not.toBe(429);
      expect(response.status).not.toBe(413);
    });
  });

  describe('request without content-length', () => {
    test('allows GET requests without content-length', async () => {
      const request = createRequest('/api/v1/assistants', { method: 'GET' });
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

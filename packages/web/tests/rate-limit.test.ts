import { describe, expect, test, beforeEach } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  createUserRateLimiter,
  getRateLimitStatus,
  withRateLimit,
  RateLimitPresets,
  type RateLimitConfig,
} from '../src/lib/rate-limit';

function createRequest(ip: string = '127.0.0.1', path: string = '/api/test'): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'GET',
    headers: {
      'x-forwarded-for': ip,
    },
  });
}

describe('rate-limit', () => {
  describe('checkRateLimit', () => {
    const testConfig: RateLimitConfig = {
      limit: 3,
      windowSec: 60,
    };

    test('allows requests under the limit', () => {
      const request = createRequest('192.168.1.1');
      const endpoint = 'test-under-limit';

      // First 3 requests should be allowed
      expect(checkRateLimit(request, endpoint, testConfig)).toBeNull();
      expect(checkRateLimit(request, endpoint, testConfig)).toBeNull();
      expect(checkRateLimit(request, endpoint, testConfig)).toBeNull();
    });

    test('blocks requests over the limit', () => {
      const request = createRequest('192.168.1.2');
      const endpoint = 'test-over-limit';

      // First 3 requests should be allowed
      expect(checkRateLimit(request, endpoint, testConfig)).toBeNull();
      expect(checkRateLimit(request, endpoint, testConfig)).toBeNull();
      expect(checkRateLimit(request, endpoint, testConfig)).toBeNull();

      // 4th request should be blocked
      const response = checkRateLimit(request, endpoint, testConfig);
      expect(response).not.toBeNull();
      expect(response?.status).toBe(429);
    });

    test('returns proper error response when rate limited', async () => {
      const request = createRequest('192.168.1.3');
      const endpoint = 'test-error-response';

      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        checkRateLimit(request, endpoint, testConfig);
      }

      // Get the rate limit response
      const response = checkRateLimit(request, endpoint, testConfig);
      expect(response).not.toBeNull();

      const data = await response!.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(data.error.message).toBe('Too many requests. Please try again later.');
    });

    test('sets proper rate limit headers on blocked response', () => {
      const request = createRequest('192.168.1.4');
      const endpoint = 'test-headers';

      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        checkRateLimit(request, endpoint, testConfig);
      }

      const response = checkRateLimit(request, endpoint, testConfig);
      expect(response).not.toBeNull();

      expect(response!.headers.get('Retry-After')).toBeDefined();
      expect(response!.headers.get('X-RateLimit-Limit')).toBe('3');
      expect(response!.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(response!.headers.get('X-RateLimit-Reset')).toBeDefined();
    });

    test('different IPs have separate rate limits', () => {
      const request1 = createRequest('192.168.2.1');
      const request2 = createRequest('192.168.2.2');
      const endpoint = 'test-separate-ips';

      // Exhaust limit for IP 1
      for (let i = 0; i < 3; i++) {
        checkRateLimit(request1, endpoint, testConfig);
      }
      expect(checkRateLimit(request1, endpoint, testConfig)).not.toBeNull();

      // IP 2 should still be allowed
      expect(checkRateLimit(request2, endpoint, testConfig)).toBeNull();
    });

    test('different endpoints have separate rate limits', () => {
      const request = createRequest('192.168.3.1');

      // Exhaust limit for endpoint1
      for (let i = 0; i < 3; i++) {
        checkRateLimit(request, 'endpoint1', testConfig);
      }
      expect(checkRateLimit(request, 'endpoint1', testConfig)).not.toBeNull();

      // endpoint2 should still be allowed
      expect(checkRateLimit(request, 'endpoint2', testConfig)).toBeNull();
    });

    test('uses x-real-ip header as fallback', () => {
      const request = new NextRequest('http://localhost/api/test', {
        method: 'GET',
        headers: {
          'x-real-ip': '10.0.0.1',
        },
      });
      const endpoint = 'test-real-ip';

      // First request should be allowed
      expect(checkRateLimit(request, endpoint, testConfig)).toBeNull();
    });

    test('uses cf-connecting-ip header for Cloudflare', () => {
      const request = new NextRequest('http://localhost/api/test', {
        method: 'GET',
        headers: {
          'cf-connecting-ip': '172.16.0.1',
        },
      });
      const endpoint = 'test-cloudflare-ip';

      // First request should be allowed
      expect(checkRateLimit(request, endpoint, testConfig)).toBeNull();
    });

    test('custom keyGenerator overrides IP extraction', () => {
      const request1 = createRequest('192.168.4.1');
      const request2 = createRequest('192.168.4.2');
      const endpoint = 'test-custom-key';

      const customConfig: RateLimitConfig = {
        limit: 2,
        windowSec: 60,
        keyGenerator: () => 'same-key-for-all', // All requests share the same key
      };

      // First 2 requests (any IP) should be allowed
      expect(checkRateLimit(request1, endpoint, customConfig)).toBeNull();
      expect(checkRateLimit(request2, endpoint, customConfig)).toBeNull();

      // 3rd request should be blocked (even different IP)
      expect(checkRateLimit(request1, endpoint, customConfig)).not.toBeNull();
    });
  });

  describe('createUserRateLimiter', () => {
    const testConfig: RateLimitConfig = {
      limit: 2,
      windowSec: 60,
    };

    test('rate limits by user ID instead of IP', () => {
      const endpoint = 'test-user-limit';

      // First 2 requests for user1 should be allowed
      expect(createUserRateLimiter('user1', endpoint, testConfig)).toBeNull();
      expect(createUserRateLimiter('user1', endpoint, testConfig)).toBeNull();

      // 3rd request for user1 should be blocked
      expect(createUserRateLimiter('user1', endpoint, testConfig)).not.toBeNull();

      // user2 should still be allowed
      expect(createUserRateLimiter('user2', endpoint, testConfig)).toBeNull();
    });

    test('returns 429 with proper headers when user rate limited', () => {
      const endpoint = 'test-user-headers';

      // Exhaust limit
      createUserRateLimiter('user3', endpoint, testConfig);
      createUserRateLimiter('user3', endpoint, testConfig);

      const response = createUserRateLimiter('user3', endpoint, testConfig);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(429);
      expect(response!.headers.get('X-RateLimit-Limit')).toBe('2');
    });
  });

  describe('getRateLimitStatus', () => {
    const testConfig: RateLimitConfig = {
      limit: 5,
      windowSec: 60,
    };

    test('returns full limit when no requests made', () => {
      const request = createRequest('192.168.5.1');
      const status = getRateLimitStatus(request, 'test-status-new', testConfig);

      expect(status.limit).toBe(5);
      expect(status.remaining).toBe(5);
      expect(status.reset).toBeGreaterThan(Date.now());
    });

    test('decrements remaining after requests', () => {
      const request = createRequest('192.168.5.2');
      const endpoint = 'test-status-used';

      // Make 2 requests
      checkRateLimit(request, endpoint, testConfig);
      checkRateLimit(request, endpoint, testConfig);

      const status = getRateLimitStatus(request, endpoint, testConfig);
      expect(status.remaining).toBe(3);
    });

    test('shows 0 remaining when limit exhausted', () => {
      const request = createRequest('192.168.5.3');
      const endpoint = 'test-status-exhausted';

      // Exhaust limit
      for (let i = 0; i < 5; i++) {
        checkRateLimit(request, endpoint, testConfig);
      }

      const status = getRateLimitStatus(request, endpoint, testConfig);
      expect(status.remaining).toBe(0);
    });
  });

  describe('withRateLimit', () => {
    const testConfig: RateLimitConfig = {
      limit: 2,
      windowSec: 60,
    };

    test('calls handler when under rate limit', async () => {
      let handlerCalled = false;
      const handler = async (request: NextRequest) => {
        handlerCalled = true;
        return NextResponse.json({ success: true });
      };

      const wrappedHandler = withRateLimit(handler, 'test-wrapper', testConfig);
      const request = createRequest('192.168.6.1');

      await wrappedHandler(request);
      expect(handlerCalled).toBe(true);
    });

    test('returns 429 without calling handler when rate limited', async () => {
      let handlerCalled = false;
      const handler = async (request: NextRequest) => {
        handlerCalled = true;
        return NextResponse.json({ success: true });
      };

      const wrappedHandler = withRateLimit(handler, 'test-wrapper-blocked', testConfig);
      const request = createRequest('192.168.6.2');

      // Exhaust limit
      await wrappedHandler(request);
      await wrappedHandler(request);
      handlerCalled = false;

      // 3rd request should not call handler
      const response = await wrappedHandler(request);
      expect(handlerCalled).toBe(false);
      expect(response.status).toBe(429);
    });
  });

  describe('RateLimitPresets', () => {
    test('auth preset has strict limits', () => {
      expect(RateLimitPresets.auth.limit).toBe(5);
      expect(RateLimitPresets.auth.windowSec).toBe(60);
    });

    test('login preset has moderate limits with longer window', () => {
      expect(RateLimitPresets.login.limit).toBe(10);
      expect(RateLimitPresets.login.windowSec).toBe(15 * 60); // 15 minutes
    });

    test('api preset has standard limits', () => {
      expect(RateLimitPresets.api.limit).toBe(60);
      expect(RateLimitPresets.api.windowSec).toBe(60);
    });

    test('chat preset has moderate limits', () => {
      expect(RateLimitPresets.chat.limit).toBe(30);
      expect(RateLimitPresets.chat.windowSec).toBe(60);
    });

    test('relaxed preset has high limits', () => {
      expect(RateLimitPresets.relaxed.limit).toBe(120);
      expect(RateLimitPresets.relaxed.windowSec).toBe(60);
    });
  });
});

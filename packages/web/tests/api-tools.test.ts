import { describe, expect, test, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock auth middleware to allow API key or Bearer token auth
mock.module('@/lib/auth/middleware', () => ({
  withApiKeyAuth: (handler: any) => async (req: any) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 }
      );
    }
    const token = authHeader.substring(7);
    if (token === 'invalid') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }
    (req as any).user = { userId: 'user-123', email: 'test@example.com', role: 'user' };
    (req as any).apiKeyPermissions = ['read:tools'];
    return handler(req);
  },
  withScopedAuth: (scopes: string[], handler: any) => async (req: any) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 }
      );
    }
    const token = authHeader.substring(7);
    if (token === 'invalid') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }
    (req as any).user = { userId: 'user-123', email: 'test@example.com', role: 'user' };
    (req as any).apiKeyPermissions = ['read:tools'];
    return handler(req);
  },
}));

const { GET } = await import('../src/app/api/v1/tools/route');

function createRequest(options: {
  token?: string;
  searchParams?: Record<string, string>;
} = {}): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/tools');

  // Add search params
  if (options.searchParams) {
    Object.entries(options.searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  return new NextRequest(url, { headers });
}

describe('GET /api/v1/tools', () => {
  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/tools');
      const request = new NextRequest(url);

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createRequest({ token: 'invalid' });

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('allows API key authentication', async () => {
      const request = createRequest({ token: 'sk_live_test_api_key_12345' });

      const response = await GET(request);

      // Should succeed (mock allows any valid format)
      expect(response.status).toBe(200);
    });
  });

  describe('tools listing', () => {
    test('returns paginated list of tools', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.items).toBeDefined();
      expect(Array.isArray(data.data.items)).toBe(true);
    });

    test('returns pagination metadata', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.total).toBeDefined();
      expect(typeof data.data.total).toBe('number');
      expect(data.data.page).toBeDefined();
      expect(data.data.limit).toBeDefined();
      expect(data.data.totalPages).toBeDefined();
    });

    test('returns categories list', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.categories).toBeDefined();
      expect(Array.isArray(data.data.categories)).toBe(true);
    });

    test('each tool has required fields', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      for (const tool of data.data.items) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('category');
      }
    });

    test('all tools have non-empty descriptions', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      for (const tool of data.data.items) {
        expect(tool.description).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('pagination', () => {
    test('respects page parameter', async () => {
      const request = createRequest({ searchParams: { page: '2', limit: '10' } });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(2);
    });

    test('respects limit parameter', async () => {
      const request = createRequest({ searchParams: { limit: '5' } });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.limit).toBe(5);
      expect(data.data.items.length).toBeLessThanOrEqual(5);
    });

    test('enforces maximum limit of 100', async () => {
      const request = createRequest({ searchParams: { limit: '500' } });

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.limit).toBeLessThanOrEqual(100);
    });

    test('defaults to page 1', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.page).toBe(1);
    });

    test('handles invalid page gracefully', async () => {
      const request = createRequest({ searchParams: { page: '-1' } });

      const response = await GET(request);
      const data = await response.json();

      // Should clamp to minimum page 1
      expect(data.data.page).toBeGreaterThanOrEqual(1);
    });
  });

  describe('filtering', () => {
    test('filters by search query', async () => {
      const request = createRequest({ searchParams: { search: 'bash' } });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Results should match search query (if any exist)
      if (data.data.items.length > 0) {
        for (const tool of data.data.items) {
          const nameMatch = tool.name.toLowerCase().includes('bash');
          const descMatch = tool.description.toLowerCase().includes('bash');
          expect(nameMatch || descMatch).toBe(true);
        }
      }
    });

    test('filters by category', async () => {
      const request = createRequest({ searchParams: { category: 'system' } });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      for (const tool of data.data.items) {
        expect(tool.category).toBe('system');
      }
    });

    test('combines multiple filters', async () => {
      const request = createRequest({
        searchParams: {
          category: 'system',
          search: 'bash',
        }
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      for (const tool of data.data.items) {
        expect(tool.category).toBe('system');
        const nameMatch = tool.name.toLowerCase().includes('bash');
        const descMatch = tool.description.toLowerCase().includes('bash');
        expect(nameMatch || descMatch).toBe(true);
      }
    });
  });

  describe('sorting', () => {
    test('sorts by name ascending', async () => {
      const request = createRequest({
        searchParams: { sortBy: 'name', sortDir: 'asc' }
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const names = data.data.items.map((t: any) => t.name);
      const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sortedNames);
    });

    test('sorts by name descending', async () => {
      const request = createRequest({
        searchParams: { sortBy: 'name', sortDir: 'desc' }
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const names = data.data.items.map((t: any) => t.name);
      const sortedNames = [...names].sort((a, b) => b.localeCompare(a));
      expect(names).toEqual(sortedNames);
    });

    test('sorts by category', async () => {
      const request = createRequest({
        searchParams: { sortBy: 'category', sortDir: 'asc' }
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const categories = data.data.items.map((t: any) => t.category);
      const sortedCategories = [...categories].sort((a, b) => a.localeCompare(b));
      expect(categories).toEqual(sortedCategories);
    });

    test('defaults to sorting by name ascending', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const names = data.data.items.map((t: any) => t.name);
      const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sortedNames);
    });
  });
});

import { describe, expect, test, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Token types for testing different auth scenarios
const TOKEN_NO_SCOPE = 'api-key-no-scope';
const TOKEN_WRONG_SCOPE = 'api-key-wrong-scope';
const TOKEN_WITH_SCOPE = 'api-key-with-scope';
const TOKEN_ADMIN = 'api-key-admin';
const TOKEN_JWT = 'jwt-token';

// Mock auth middleware to test scoped API key authentication
mock.module('@/lib/auth/middleware', () => createAuthMiddlewareMock({
  withScopedApiKeyAuth: (requiredScopes: string[], handler: any) => async (req: any) => {
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

    // Set up user
    (req as any).user = { userId: 'user-123', email: 'test@example.com', role: 'user' };

    // Determine permissions based on token type
    let permissions: string[] | undefined;
    if (token === TOKEN_NO_SCOPE) {
      permissions = [];
    } else if (token === TOKEN_WRONG_SCOPE) {
      permissions = ['read:assistants', 'write:assistants'];
    } else if (token === TOKEN_WITH_SCOPE) {
      permissions = ['read:tools'];
    } else if (token === TOKEN_ADMIN) {
      permissions = ['admin'];
    } else if (token === TOKEN_JWT) {
      // JWT tokens don't have apiKeyPermissions
      permissions = undefined;
    } else {
      // Default case for backward compatibility - treat as having scope
      permissions = ['read:tools'];
    }

    (req as any).apiKeyPermissions = permissions;

    // Check scopes (mimicking withScopedApiKeyAuth logic)
    if (permissions !== undefined) {
      // API key - check scopes
      if (permissions.includes('admin')) {
        return handler(req);
      }
      const missingScopes = requiredScopes.filter(scope => !permissions!.includes(scope));
      if (missingScopes.length > 0) {
        return NextResponse.json(
          { success: false, error: { code: 'FORBIDDEN', message: `API key missing required scopes: ${missingScopes.join(', ')}` } },
          { status: 403 }
        );
      }
    }

    // JWT or API key with required scopes - allow
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

    test('allows API key authentication with correct scope', async () => {
      const request = createRequest({ token: TOKEN_WITH_SCOPE });

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test('allows JWT tokens (no apiKeyPermissions)', async () => {
      const request = createRequest({ token: TOKEN_JWT });

      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test('allows admin API keys', async () => {
      const request = createRequest({ token: TOKEN_ADMIN });

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe('scope enforcement', () => {
    test('returns 403 for API key without any scope', async () => {
      const request = createRequest({ token: TOKEN_NO_SCOPE });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
      expect(data.error.message).toContain('read:tools');
    });

    test('returns 403 for API key with wrong scope', async () => {
      const request = createRequest({ token: TOKEN_WRONG_SCOPE });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
      expect(data.error.message).toContain('read:tools');
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

    test('includes connector auto-refresh tool', async () => {
      const request = createRequest({ searchParams: { search: 'connector_autorefresh' } });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.items.some((tool: any) => tool.name === 'connector_autorefresh')).toBe(true);
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

afterAll(() => {
  mock.restore();
});

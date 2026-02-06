import { describe, expect, test, mock, beforeAll, afterAll } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Token types for testing different auth scenarios
const TOKEN_NO_SCOPE = 'api-key-no-scope';
const TOKEN_WRONG_SCOPE = 'api-key-wrong-scope';
const TOKEN_WITH_SCOPE = 'api-key-with-scope';
const TOKEN_ADMIN = 'api-key-admin';
const TOKEN_JWT = 'jwt-token';

// Mock auth middleware to test scoped API key authentication
mock.module('@/lib/auth/middleware', () => ({
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
      permissions = ['read:skills'];
    } else if (token === TOKEN_ADMIN) {
      permissions = ['admin'];
    } else if (token === TOKEN_JWT) {
      // JWT tokens don't have apiKeyPermissions
      permissions = undefined;
    } else {
      // Default case for backward compatibility - treat as having scope
      permissions = ['read:skills'];
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

const { GET } = await import('../src/app/api/v1/skills/route');

function createRequest(options: {
  token?: string;
  searchParams?: Record<string, string>;
} = {}): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/skills');

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

describe('GET /api/v1/skills', () => {
  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/skills');
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
      expect(data.error.message).toContain('read:skills');
    });

    test('returns 403 for API key with wrong scope', async () => {
      const request = createRequest({ token: TOKEN_WRONG_SCOPE });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
      expect(data.error.message).toContain('read:skills');
    });
  });

  describe('skills listing', () => {
    test('returns paginated list of skills', async () => {
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

    test('each skill has required fields', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      for (const skill of data.data.items) {
        expect(skill).toHaveProperty('name');
        expect(skill).toHaveProperty('description');
        expect(skill).toHaveProperty('category');
        expect(skill).toHaveProperty('userInvocable');
        expect(skill).toHaveProperty('sourceId');
        // Should NOT expose filePath for security
        expect(skill.filePath).toBeUndefined();
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
      const request = createRequest({ searchParams: { search: 'test' } });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Results should match search query (if any exist)
      if (data.data.items.length > 0) {
        for (const skill of data.data.items) {
          const nameMatch = skill.name.toLowerCase().includes('test');
          const descMatch = skill.description.toLowerCase().includes('test');
          expect(nameMatch || descMatch).toBe(true);
        }
      }
    });

    test('filters by category', async () => {
      const request = createRequest({ searchParams: { category: 'shared' } });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      for (const skill of data.data.items) {
        expect(skill.category).toBe('shared');
      }
    });

    test('filters by userInvocableOnly', async () => {
      const request = createRequest({ searchParams: { userInvocableOnly: 'true' } });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      for (const skill of data.data.items) {
        expect(skill.userInvocable).toBe(true);
      }
    });

    test('combines multiple filters', async () => {
      const request = createRequest({
        searchParams: {
          category: 'shared',
          userInvocableOnly: 'true',
        }
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      for (const skill of data.data.items) {
        expect(skill.category).toBe('shared');
        expect(skill.userInvocable).toBe(true);
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
      const names = data.data.items.map((s: any) => s.name);
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
      const names = data.data.items.map((s: any) => s.name);
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
      const categories = data.data.items.map((s: any) => s.category);
      const sortedCategories = [...categories].sort((a, b) => a.localeCompare(b));
      expect(categories).toEqual(sortedCategories);
    });

    test('defaults to sorting by name ascending', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const names = data.data.items.map((s: any) => s.name);
      const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sortedNames);
    });
  });

  describe('security', () => {
    test('does not expose file paths', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      for (const skill of data.data.items) {
        expect(skill.filePath).toBeUndefined();
      }
    });

    test('includes safe sourceId instead of filePath', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      for (const skill of data.data.items) {
        expect(skill.sourceId).toBeDefined();
        // sourceId format should be "category/name"
        expect(skill.sourceId).toMatch(/^[a-z]+\/[a-z0-9-]+$/i);
      }
    });
  });
});

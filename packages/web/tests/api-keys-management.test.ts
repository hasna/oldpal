import { describe, expect, test, afterAll, mock, beforeEach, afterEach } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// In-memory mock database for API keys
let mockApiKeys: Array<{
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  permissions: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}> = [];

// Reset mock data before each test
beforeEach(() => {
  mockApiKeys = [];
});

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => createAuthMiddlewareMock({
  withAuth: (handler: any) => async (req: any, context?: any) => {
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
    // Different users based on token
    const userId = token === 'user2-token' ? 'user-456' : 'user-123';
    (req as any).user = { userId, email: `${userId}@example.com`, role: 'user' };
    return handler(req, context);
  },
}));

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      apiKeys: {
        findMany: async (options: any) => {
          // Filter: only return non-revoked keys for the user
          return mockApiKeys.filter((key) => {
            return key.userId === 'user-123' && key.revokedAt === null;
          }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        },
        findFirst: async (options: any) => {
          // Find first non-revoked key
          return mockApiKeys.find((key) => key.revokedAt === null);
        },
      },
    },
    insert: (table: any) => ({
      values: (data: any) => ({
        returning: async () => {
          const newKey = {
            id: `key-${Date.now()}`,
            ...data,
            permissions: data.permissions || [],
            createdAt: new Date(),
            revokedAt: null,
            lastUsedAt: null,
          };
          mockApiKeys.push(newKey);
          return [newKey];
        },
      }),
    }),
    update: (table: any) => ({
      set: (data: any) => ({
        where: (condition: any) => {
          // Update matching keys
          mockApiKeys = mockApiKeys.map((key) => {
            if (data.revokedAt) {
              return { ...key, revokedAt: data.revokedAt };
            }
            return key;
          });
          return Promise.resolve();
        },
      }),
    }),
  },
  schema: createSchemaMock(),
}));

// Mock drizzle-orm operators
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value, op: 'eq' }),
  and: (...conditions: any[]) => conditions,
  isNull: (field: any) => ({ field, op: 'isNull' }),
  desc: (field: any) => ({ field, dir: 'desc' }),
}));

// Mock schema
mock.module('@/db/schema', () => createSchemaMock({
  apiKeys: {
    id: 'id',
    userId: 'userId',
    name: 'name',
    keyPrefix: 'keyPrefix',
    keyHash: 'keyHash',
    permissions: 'permissions',
    lastUsedAt: 'lastUsedAt',
    expiresAt: 'expiresAt',
    createdAt: 'createdAt',
    revokedAt: 'revokedAt',
  },
}));

// Import routes after mocks
const { GET, POST } = await import('../src/app/api/v1/users/me/api-keys/route');
const { GET: GET_BY_ID, DELETE } = await import('../src/app/api/v1/users/me/api-keys/[id]/route');

function createRequest(options: {
  method?: string;
  token?: string;
  body?: unknown;
} = {}): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/users/me/api-keys');

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const init: RequestInit = {
    method: options.method || 'GET',
    headers,
  };

  if (options.body) {
    init.body = JSON.stringify(options.body);
  }

  return new NextRequest(url, init);
}

function createRequestWithId(id: string, options: {
  method?: string;
  token?: string;
} = {}) {
  const url = new URL(`http://localhost:3001/api/v1/users/me/api-keys/${id}`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, {
    method: options.method || 'GET',
    headers,
  });

  return { request, context: { params: Promise.resolve({ id }) } };
}

describe('GET /api/v1/users/me/api-keys', () => {
  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/users/me/api-keys');
      const request = new NextRequest(url);

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createRequest({ token: 'invalid' });

      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    test('returns 200 for valid token', async () => {
      const request = createRequest();

      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe('listing keys', () => {
    test('returns empty array when user has no keys', async () => {
      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.keys).toEqual([]);
      expect(data.data.count).toBe(0);
    });

    test('returns keys without exposing hash', async () => {
      // Add a mock key
      mockApiKeys.push({
        id: 'key-1',
        userId: 'user-123',
        name: 'Test Key',
        keyPrefix: 'sk_live_test',
        keyHash: 'secret_hash',
        permissions: [],
        lastUsedAt: null,
        expiresAt: null,
        createdAt: new Date(),
        revokedAt: null,
      });

      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.keys.length).toBe(1);
      expect(data.data.keys[0].name).toBe('Test Key');
      expect(data.data.keys[0].keyPrefix).toBe('sk_live_test');
      // Hash should NOT be exposed
      expect(data.data.keys[0].keyHash).toBeUndefined();
    });

    test('does not return revoked keys', async () => {
      // Add an active key and a revoked key
      mockApiKeys.push({
        id: 'key-1',
        userId: 'user-123',
        name: 'Active Key',
        keyPrefix: 'sk_live_act1',
        keyHash: 'hash1',
        permissions: [],
        lastUsedAt: null,
        expiresAt: null,
        createdAt: new Date(),
        revokedAt: null,
      });
      mockApiKeys.push({
        id: 'key-2',
        userId: 'user-123',
        name: 'Revoked Key',
        keyPrefix: 'sk_live_rev1',
        keyHash: 'hash2',
        permissions: [],
        lastUsedAt: null,
        expiresAt: null,
        createdAt: new Date(),
        revokedAt: new Date(),
      });

      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      // Only active keys should be returned
      expect(data.data.count).toBe(1);
      expect(data.data.keys[0].name).toBe('Active Key');
    });

    test('returns key with lastUsedAt and expiresAt', async () => {
      const lastUsed = new Date('2024-01-15');
      const expires = new Date('2024-12-31');

      mockApiKeys.push({
        id: 'key-1',
        userId: 'user-123',
        name: 'Key with dates',
        keyPrefix: 'sk_live_date',
        keyHash: 'hash',
        permissions: ['read:all'],
        lastUsedAt: lastUsed,
        expiresAt: expires,
        createdAt: new Date(),
        revokedAt: null,
      });

      const request = createRequest();

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.keys[0].lastUsedAt).toBeDefined();
      expect(data.data.keys[0].expiresAt).toBeDefined();
      expect(data.data.keys[0].permissions).toEqual(['read:all']);
    });
  });
});

describe('POST /api/v1/users/me/api-keys', () => {
  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/users/me/api-keys');
      const request = new NextRequest(url, {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
    });
  });

  describe('key creation', () => {
    test('creates a new API key', async () => {
      const request = createRequest({
        method: 'POST',
        body: { name: 'My New Key' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.key.name).toBe('My New Key');
      expect(data.data.key.fullKey).toBeDefined();
      expect(data.data.key.keyPrefix).toBeDefined();
      expect(data.data.message).toContain('copy it now');
    });

    test('creates key with expiration date', async () => {
      const expiresAt = new Date('2025-12-31T23:59:59Z').toISOString();
      const request = createRequest({
        method: 'POST',
        body: { name: 'Expiring Key', expiresAt },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.key.expiresAt).toBeDefined();
    });

    test('returns fullKey only on creation', async () => {
      const request = createRequest({
        method: 'POST',
        body: { name: 'Secret Key' },
      });

      const response = await POST(request);
      const data = await response.json();

      // fullKey should be present on creation
      expect(typeof data.data.key.fullKey).toBe('string');
      expect(data.data.key.fullKey.startsWith('sk_live_')).toBe(true);
    });

    test('returns 422 when name is missing', async () => {
      const request = createRequest({
        method: 'POST',
        body: {},
      });

      const response = await POST(request);

      // Zod validation errors return 422 Unprocessable Entity
      expect(response.status).toBe(422);
    });

    test('returns 422 when name is too long', async () => {
      const request = createRequest({
        method: 'POST',
        body: { name: 'a'.repeat(101) },
      });

      const response = await POST(request);

      // Zod validation errors return 422 Unprocessable Entity
      expect(response.status).toBe(422);
    });
  });

  describe('key limit', () => {
    test('returns 400 when user has 10 keys', async () => {
      // Add 10 mock keys
      for (let i = 0; i < 10; i++) {
        mockApiKeys.push({
          id: `key-${i}`,
          userId: 'user-123',
          name: `Key ${i}`,
          keyPrefix: `sk_live_k${i}`,
          keyHash: `hash${i}`,
          permissions: [],
          lastUsedAt: null,
          expiresAt: null,
          createdAt: new Date(),
          revokedAt: null,
        });
      }

      const request = createRequest({
        method: 'POST',
        body: { name: 'One More Key' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.message).toContain('Maximum of 10 API keys');
    });

    test('allows creation after revoking a key', async () => {
      // Add 9 active keys and 1 revoked key
      for (let i = 0; i < 9; i++) {
        mockApiKeys.push({
          id: `key-${i}`,
          userId: 'user-123',
          name: `Key ${i}`,
          keyPrefix: `sk_live_k${i}`,
          keyHash: `hash${i}`,
          permissions: [],
          lastUsedAt: null,
          expiresAt: null,
          createdAt: new Date(),
          revokedAt: null,
        });
      }
      mockApiKeys.push({
        id: 'key-revoked',
        userId: 'user-123',
        name: 'Revoked Key',
        keyPrefix: 'sk_live_rev',
        keyHash: 'hashrev',
        permissions: [],
        lastUsedAt: null,
        expiresAt: null,
        createdAt: new Date(),
        revokedAt: new Date(),
      });

      const request = createRequest({
        method: 'POST',
        body: { name: 'New Key After Revoke' },
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });
});

describe('GET /api/v1/users/me/api-keys/[id]', () => {
  test('returns 401 when no token provided', async () => {
    const { request, context } = createRequestWithId('key-1', { token: '' });
    const url = new URL('http://localhost:3001/api/v1/users/me/api-keys/key-1');
    const rawRequest = new NextRequest(url);

    const response = await GET_BY_ID(rawRequest, context);

    expect(response.status).toBe(401);
  });

  test('returns key details without hash', async () => {
    mockApiKeys.push({
      id: 'key-1',
      userId: 'user-123',
      name: 'Specific Key',
      keyPrefix: 'sk_live_spec',
      keyHash: 'secret_hash',
      permissions: ['read:assistants'],
      lastUsedAt: new Date(),
      expiresAt: null,
      createdAt: new Date(),
      revokedAt: null,
    });

    const { request, context } = createRequestWithId('key-1');

    const response = await GET_BY_ID(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.key.name).toBe('Specific Key');
    expect(data.data.key.keyHash).toBeUndefined();
    expect(data.data.key.permissions).toEqual(['read:assistants']);
  });
});

describe('DELETE /api/v1/users/me/api-keys/[id]', () => {
  test('returns 401 when no token provided', async () => {
    const url = new URL('http://localhost:3001/api/v1/users/me/api-keys/key-1');
    const rawRequest = new NextRequest(url, { method: 'DELETE' });
    const context = { params: Promise.resolve({ id: 'key-1' }) };

    const response = await DELETE(rawRequest, context);

    expect(response.status).toBe(401);
  });

  test('revokes key by setting revokedAt', async () => {
    mockApiKeys.push({
      id: 'key-to-revoke',
      userId: 'user-123',
      name: 'Key to Revoke',
      keyPrefix: 'sk_live_rev1',
      keyHash: 'hash',
      permissions: [],
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      revokedAt: null,
    });

    const { request, context } = createRequestWithId('key-to-revoke', { method: 'DELETE' });

    const response = await DELETE(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.success).toBe(true);
    expect(data.data.message).toContain('revoked');
  });

  test('returns success message on revocation', async () => {
    mockApiKeys.push({
      id: 'key-123',
      userId: 'user-123',
      name: 'Test Key',
      keyPrefix: 'sk_live_test',
      keyHash: 'hash',
      permissions: [],
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      revokedAt: null,
    });

    const { request, context } = createRequestWithId('key-123', { method: 'DELETE' });

    const response = await DELETE(request, context);
    const data = await response.json();

    expect(data.data.success).toBe(true);
    expect(data.data.message).toContain('successfully');
  });
});

afterAll(() => {
  mock.restore();
});

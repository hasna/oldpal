import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state
let mockUser: any = null;
let mockUpdatedUser: any = null;
let updateSetData: any = null;
let currentUserRole = 'user';
const validUserId = '11111111-1111-1111-1111-111111111111';
const otherUserId = '22222222-2222-2222-2222-222222222222';
let currentUserId = validUserId;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => mockUser,
      },
    },
    update: (table: any) => ({
      set: (data: any) => {
        updateSetData = data;
        return {
          where: (condition: any) => ({
            returning: () => mockUpdatedUser ? [mockUpdatedUser] : mockUser ? [{ ...mockUser, ...data }] : [],
          }),
        };
      },
    }),
  },
  schema: createSchemaMock(),
}));

// Mock db schema
mock.module('@/db/schema', () => createSchemaMock({
  users: {
    id: 'id',
    email: 'email',
    name: 'name',
    avatarUrl: 'avatarUrl',
    role: 'role',
  },
}));

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => createAuthMiddlewareMock({
  withAuth: (handler: any) => async (req: any, context: any) => {
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
    (req as any).user = { userId: currentUserId, email: 'test@example.com', role: currentUserRole };
    return handler(req, context);
  },
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
}));

const { GET, PATCH } = await import('../src/app/api/v1/users/[id]/route');

function createGetRequest(
  userId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/users/${userId}`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { headers });
  const context = { params: { id: userId } };

  return [request, context];
}

function createPatchRequest(
  userId: string,
  body: Record<string, unknown>,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/users/${userId}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  const context = { params: { id: userId } };

  return [request, context];
}

describe('GET /api/v1/users/:id', () => {
  beforeEach(() => {
    mockUser = {
      id: validUserId,
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: null,
      role: 'user',
      emailVerified: true,
      createdAt: new Date(),
    };
    mockUpdatedUser = null;
    updateSetData = null;
    currentUserRole = 'user';
    currentUserId = validUserId;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL(`http://localhost:3001/api/v1/users/${validUserId}`);
      const request = new NextRequest(url);
      const context = { params: { id: validUserId } };

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const [request, context] = createGetRequest(validUserId, { token: 'invalid' });

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('user retrieval', () => {
    test('returns user profile when user views own profile', async () => {
      const [request, context] = createGetRequest(validUserId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(validUserId);
      expect(data.data.email).toBe('test@example.com');
    });

    test('returns user data with expected fields', async () => {
      const [request, context] = createGetRequest(validUserId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(data.data).toHaveProperty('id');
      expect(data.data).toHaveProperty('email');
      expect(data.data).toHaveProperty('name');
      expect(data.data).toHaveProperty('avatarUrl');
      expect(data.data).toHaveProperty('role');
      expect(data.data).toHaveProperty('emailVerified');
      expect(data.data).toHaveProperty('createdAt');
    });

    test('returns 404 when user not found', async () => {
      mockUser = null;
      const [request, context] = createGetRequest(validUserId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('authorization', () => {
    test('returns 403 when user tries to view another user profile', async () => {
      currentUserId = validUserId;
      mockUser = { id: otherUserId };
      const [request, context] = createGetRequest(otherUserId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });

    test('admin can view any user profile', async () => {
      currentUserRole = 'admin';
      currentUserId = '33333333-3333-3333-3333-333333333333';
      mockUser = {
        id: otherUserId,
        email: 'other@example.com',
        name: 'Other User',
        role: 'user',
      };
      const [request, context] = createGetRequest(otherUserId);

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.id).toBe(otherUserId);
    });
  });
});

describe('PATCH /api/v1/users/:id', () => {
  beforeEach(() => {
    mockUser = {
      id: validUserId,
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: null,
      role: 'user',
    };
    mockUpdatedUser = null;
    updateSetData = null;
    currentUserRole = 'user';
    currentUserId = validUserId;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL(`http://localhost:3001/api/v1/users/${validUserId}`);
      const request = new NextRequest(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });
      const context = { params: { id: validUserId } };

      const response = await PATCH(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('user updates', () => {
    test('updates user name', async () => {
      const [request, context] = createPatchRequest(validUserId, { name: 'Updated Name' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(updateSetData.name).toBe('Updated Name');
    });

    test('updates user avatarUrl', async () => {
      const [request, context] = createPatchRequest(validUserId, {
        avatarUrl: 'https://example.com/avatar.png',
      });

      const response = await PATCH(request, context);

      expect(response.status).toBe(200);
      expect(updateSetData.avatarUrl).toBe('https://example.com/avatar.png');
    });

    test('allows null avatarUrl', async () => {
      const [request, context] = createPatchRequest(validUserId, { avatarUrl: null });

      const response = await PATCH(request, context);

      expect(response.status).toBe(200);
      expect(updateSetData.avatarUrl).toBeNull();
    });

    test('updates both name and avatarUrl', async () => {
      const [request, context] = createPatchRequest(validUserId, {
        name: 'New Name',
        avatarUrl: 'https://example.com/new-avatar.png',
      });

      const response = await PATCH(request, context);

      expect(response.status).toBe(200);
      expect(updateSetData.name).toBe('New Name');
      expect(updateSetData.avatarUrl).toBe('https://example.com/new-avatar.png');
    });

    test('sets updatedAt timestamp', async () => {
      const [request, context] = createPatchRequest(validUserId, { name: 'New Name' });

      await PATCH(request, context);

      expect(updateSetData.updatedAt).toBeInstanceOf(Date);
    });

    test('returns updated user data', async () => {
      mockUpdatedUser = {
        id: validUserId,
        email: 'test@example.com',
        name: 'Updated Name',
        avatarUrl: null,
        role: 'user',
      };
      const [request, context] = createPatchRequest(validUserId, { name: 'Updated Name' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(data.data.id).toBe(validUserId);
      expect(data.data.email).toBe('test@example.com');
      expect(data.data.name).toBe('Updated Name');
    });
  });

  describe('authorization', () => {
    test('returns 403 when user tries to update another user', async () => {
      currentUserId = validUserId;
      const [request, context] = createPatchRequest(otherUserId, { name: 'New Name' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });

    test('admin cannot update other users', async () => {
      currentUserRole = 'admin';
      currentUserId = '33333333-3333-3333-3333-333333333333';
      const [request, context] = createPatchRequest(otherUserId, { name: 'New Name' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('validation', () => {
    test('returns 422 when name is empty', async () => {
      const [request, context] = createPatchRequest(validUserId, { name: '' });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });

    test('returns 422 when name exceeds 255 characters', async () => {
      const [request, context] = createPatchRequest(validUserId, { name: 'a'.repeat(256) });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });

    test('returns 422 for invalid avatarUrl', async () => {
      const [request, context] = createPatchRequest(validUserId, { avatarUrl: 'not-a-url' });

      const response = await PATCH(request, context);

      expect(response.status).toBe(422);
    });

    test('accepts empty body (no updates)', async () => {
      const [request, context] = createPatchRequest(validUserId, {});

      const response = await PATCH(request, context);

      expect(response.status).toBe(200);
    });
  });
});

afterAll(() => {
  mock.restore();
});

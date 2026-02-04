import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock data
let mockUser: any = null;
let mockSessionCount = 5;
let mockAgentCount = 3;
let mockAdminCount = 2;
let mockUpdatedUser: any = null;

// Create full chain mock that handles any chaining pattern
function createChainMock(finalResult: any) {
  const chainableResult = () => Promise.resolve(finalResult);
  const chainable: any = {
    from: () => chainable,
    where: () => chainable,
    returning: () => chainableResult(),
    set: () => chainable,
    then: (fn: any) => chainableResult().then(fn),
  };
  return chainable;
}

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => mockUser,
      },
    },
    select: (fields: any) => {
      const fieldKeys = Object.keys(fields);
      if (fieldKeys.includes('count')) {
        // Return count based on context
        return createChainMock([{ count: mockAdminCount }]);
      }
      return createChainMock([]);
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([mockUpdatedUser]),
        }),
      }),
    }),
  },
}));

// Mock db schema
mock.module('@/db/schema', () => ({
  users: {
    id: 'id',
    email: 'email',
    name: 'name',
    role: 'role',
    isActive: 'isActive',
    suspendedAt: 'suspendedAt',
    suspendedReason: 'suspendedReason',
    updatedAt: 'updatedAt',
    emailVerified: 'emailVerified',
    avatarUrl: 'avatarUrl',
    createdAt: 'createdAt',
    stripeCustomerId: 'stripeCustomerId',
  },
  sessions: { userId: 'userId' },
  agents: { userId: 'userId' },
}));

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => ({
  withAdminAuth: (handler: any) => async (req: any, context: any) => {
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
    if (token === 'user-token') {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
        { status: 403 }
      );
    }
    (req as any).user = { userId: 'admin-123', email: 'admin@example.com', role: 'admin' };
    return handler(req, context);
  },
  invalidateUserStatusCache: () => {},
}));

// Mock API response helpers
mock.module('@/lib/api/response', () => ({
  successResponse: (data: any) => {
    return NextResponse.json({ success: true, data });
  },
  errorResponse: (error: any) => {
    if (error.name === 'NotFoundError') {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: error.message } },
        { status: 404 }
      );
    }
    if (error.name === 'BadRequestError') {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: error.message } },
        { status: 400 }
      );
    }
    if (error.name === 'ZodError') {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed' } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } },
      { status: 500 }
    );
  },
}));

// Mock API errors
mock.module('@/lib/api/errors', () => ({
  validateUUID: (id: string, name: string) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      const error = new Error(`Invalid ${name}: ${id}`);
      error.name = 'BadRequestError';
      throw error;
    }
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
  BadRequestError: class BadRequestError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'BadRequestError';
    }
  },
}));

// Mock admin audit
mock.module('@/lib/admin/audit', () => ({
  logAdminAction: async () => {},
  computeChanges: () => ({ name: { old: 'Old', new: 'New' } }),
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => ({
  count: () => ({ count: 'count' }),
  eq: (field: any, value: any) => ({ eq: [field, value] }),
}));

// Mock Zod (allow schema to pass through)
mock.module('zod', () => {
  const z = {
    object: (schema: any) => ({
      parse: (data: any) => data,
    }),
    string: () => ({
      min: () => ({
        max: () => ({ optional: () => ({ nullable: () => ({}) }) }),
      }),
      max: () => ({ optional: () => ({ nullable: () => ({}) }) }),
      email: () => ({
        max: () => ({ optional: () => ({}) }),
      }),
      optional: () => ({}),
    }),
    enum: () => ({ optional: () => ({}) }),
    boolean: () => ({ optional: () => ({}) }),
  };
  return { z };
});

const { GET, PATCH, DELETE } = await import(
  '../src/app/api/v1/admin/users/[id]/route'
);

const validUserId = '123e4567-e89b-12d3-a456-426614174000';

function createRequest(options: {
  token?: string;
  method?: string;
  body?: object;
} = {}): NextRequest {
  const url = new URL(`http://localhost:3001/api/v1/admin/users/${validUserId}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer admin-token';
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

function createContext(id: string = validUserId) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/v1/admin/users/:id', () => {
  beforeEach(() => {
    mockUser = {
      id: validUserId,
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      emailVerified: true,
      avatarUrl: null,
      isActive: true,
      suspendedAt: null,
      suspendedReason: null,
      stripeCustomerId: 'cus_123',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-15'),
    };
    mockSessionCount = 5;
    mockAgentCount = 3;
    mockAdminCount = 2;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL(`http://localhost:3001/api/v1/admin/users/${validUserId}`);
      const request = new NextRequest(url);

      const response = await GET(request, createContext());

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const request = createRequest({ token: 'invalid' });

      const response = await GET(request, createContext());

      expect(response.status).toBe(401);
    });
  });

  describe('authorization', () => {
    test('returns 403 for non-admin users', async () => {
      const request = createRequest({ token: 'user-token' });

      const response = await GET(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('validation', () => {
    test('returns 400 for invalid UUID', async () => {
      const request = createRequest();

      const response = await GET(request, createContext('invalid-uuid'));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe('get user details', () => {
    test('returns user details with counts', async () => {
      const request = createRequest();

      const response = await GET(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(validUserId);
      expect(data.data.email).toBe('test@example.com');
      expect(data.data._counts).toBeDefined();
    });

    test('returns 404 for non-existent user', async () => {
      mockUser = null;
      const request = createRequest();

      const response = await GET(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('response shape', () => {
    test('returns correct user fields', async () => {
      const request = createRequest();

      const response = await GET(request, createContext());
      const data = await response.json();

      expect(data.data).toHaveProperty('id');
      expect(data.data).toHaveProperty('email');
      expect(data.data).toHaveProperty('name');
      expect(data.data).toHaveProperty('role');
      expect(data.data).toHaveProperty('emailVerified');
      expect(data.data).toHaveProperty('isActive');
      expect(data.data).toHaveProperty('_counts');
    });
  });
});

describe('PATCH /api/v1/admin/users/:id', () => {
  beforeEach(() => {
    mockUser = {
      id: validUserId,
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      isActive: true,
      suspendedReason: null,
    };
    mockUpdatedUser = {
      id: validUserId,
      email: 'test@example.com',
      name: 'Updated Name',
      role: 'user',
      emailVerified: true,
      avatarUrl: null,
      isActive: true,
      suspendedAt: null,
      suspendedReason: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date(),
    };
    mockAdminCount = 2;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL(`http://localhost:3001/api/v1/admin/users/${validUserId}`);
      const request = new NextRequest(url, { method: 'PATCH' });

      const response = await PATCH(request, createContext());

      expect(response.status).toBe(401);
    });
  });

  describe('update user', () => {
    test('updates user name successfully', async () => {
      const request = createRequest({
        method: 'PATCH',
        body: { name: 'Updated Name' },
      });

      const response = await PATCH(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('returns 404 for non-existent user', async () => {
      mockUser = null;
      const request = createRequest({
        method: 'PATCH',
        body: { name: 'Updated Name' },
      });

      const response = await PATCH(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });
});

describe('DELETE /api/v1/admin/users/:id', () => {
  beforeEach(() => {
    mockUser = {
      id: validUserId,
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
    };
    mockAdminCount = 2;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL(`http://localhost:3001/api/v1/admin/users/${validUserId}`);
      const request = new NextRequest(url, { method: 'DELETE' });

      const response = await DELETE(request, createContext());

      expect(response.status).toBe(401);
    });
  });

  describe('delete user', () => {
    test('soft deletes user successfully', async () => {
      const request = createRequest({ method: 'DELETE' });

      const response = await DELETE(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.deleted).toBe(true);
    });

    test('returns 404 for non-existent user', async () => {
      mockUser = null;
      const request = createRequest({ method: 'DELETE' });

      const response = await DELETE(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });
});

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock data
let mockUser: any = null;
let mockSubscription: any = null;
let mockInvoices: any[] = [];
let mockPlans: any[] = [];
let mockPlan: any = null;
let mockNewSubscription: any = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => mockUser,
      },
      subscriptions: {
        findFirst: async () => mockSubscription,
      },
      invoices: {
        findMany: async () => mockInvoices,
      },
      subscriptionPlans: {
        findFirst: async () => mockPlan,
        findMany: async () => mockPlans,
      },
    },
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([{}]),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([mockNewSubscription]),
      }),
    }),
  },
}));

// Mock db schema
mock.module('@/db/schema', () => ({
  users: { id: 'id', stripeCustomerId: 'stripeCustomerId' },
  subscriptions: {
    id: 'id',
    userId: 'userId',
    planId: 'planId',
    status: 'status',
    currentPeriodStart: 'currentPeriodStart',
    currentPeriodEnd: 'currentPeriodEnd',
    cancelAtPeriodEnd: 'cancelAtPeriodEnd',
    updatedAt: 'updatedAt',
  },
  subscriptionPlans: {
    id: 'id',
    name: 'name',
    displayName: 'displayName',
    priceMonthly: 'priceMonthly',
    isActive: 'isActive',
  },
  invoices: {
    id: 'id',
    userId: 'userId',
    createdAt: 'createdAt',
  },
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
  computeChanges: () => ({ planId: { old: 'old-plan', new: 'new-plan' } }),
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => ({
  eq: (field: any, value: any) => ({ eq: [field, value] }),
  desc: (field: any) => ({ desc: field }),
}));

// Mock Zod
mock.module('zod', () => {
  const z = {
    object: (schema: any) => ({
      parse: (data: any) => data,
    }),
    string: () => ({
      uuid: () => ({}),
      max: () => ({ optional: () => ({}) }),
    }),
  };
  return { z };
});

const { GET, POST } = await import(
  '../src/app/api/v1/admin/users/[id]/billing/route'
);

const validUserId = '123e4567-e89b-12d3-a456-426614174000';
const validPlanId = '456e4567-e89b-12d3-a456-426614174001';

function createRequest(options: {
  token?: string;
  method?: string;
  body?: object;
} = {}): NextRequest {
  const url = new URL(`http://localhost:3001/api/v1/admin/users/${validUserId}/billing`);

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

describe('GET /api/v1/admin/users/:id/billing', () => {
  beforeEach(() => {
    mockUser = {
      id: validUserId,
      stripeCustomerId: 'cus_123456',
    };
    mockSubscription = {
      id: 'sub_123',
      status: 'active',
      currentPeriodStart: new Date('2024-01-01'),
      currentPeriodEnd: new Date('2024-02-01'),
      cancelAtPeriodEnd: false,
      plan: {
        id: validPlanId,
        name: 'pro',
        displayName: 'Pro Plan',
        priceMonthly: 2900,
      },
    };
    mockInvoices = [
      {
        id: 'inv_123',
        amountDue: 2900,
        amountPaid: 2900,
        status: 'paid',
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-02-01'),
        paidAt: new Date('2024-01-01'),
        invoiceUrl: 'https://stripe.com/invoice/123',
        createdAt: new Date('2024-01-01'),
      },
    ];
    mockPlans = [
      { id: 'plan-free', name: 'free', displayName: 'Free', priceMonthly: 0 },
      { id: validPlanId, name: 'pro', displayName: 'Pro Plan', priceMonthly: 2900 },
      { id: 'plan-enterprise', name: 'enterprise', displayName: 'Enterprise', priceMonthly: 9900 },
    ];
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL(`http://localhost:3001/api/v1/admin/users/${validUserId}/billing`);
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

  describe('get billing info', () => {
    test('returns billing info with subscription', async () => {
      const request = createRequest();

      const response = await GET(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.stripeCustomerId).toBe('cus_123456');
      expect(data.data.subscription).toBeDefined();
      expect(data.data.invoices).toBeDefined();
      expect(data.data.availablePlans).toBeDefined();
    });

    test('returns null subscription when user has none', async () => {
      mockSubscription = null;
      const request = createRequest();

      const response = await GET(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.subscription).toBeNull();
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
    test('returns correct billing fields', async () => {
      const request = createRequest();

      const response = await GET(request, createContext());
      const data = await response.json();

      expect(data.data).toHaveProperty('stripeCustomerId');
      expect(data.data).toHaveProperty('subscription');
      expect(data.data).toHaveProperty('invoices');
      expect(data.data).toHaveProperty('availablePlans');
    });

    test('subscription has correct fields when present', async () => {
      const request = createRequest();

      const response = await GET(request, createContext());
      const data = await response.json();

      const sub = data.data.subscription;
      expect(sub).toHaveProperty('id');
      expect(sub).toHaveProperty('status');
      expect(sub).toHaveProperty('currentPeriodStart');
      expect(sub).toHaveProperty('currentPeriodEnd');
      expect(sub).toHaveProperty('plan');
    });

    test('invoices have correct fields', async () => {
      const request = createRequest();

      const response = await GET(request, createContext());
      const data = await response.json();

      if (data.data.invoices.length > 0) {
        const invoice = data.data.invoices[0];
        expect(invoice).toHaveProperty('id');
        expect(invoice).toHaveProperty('amountDue');
        expect(invoice).toHaveProperty('amountPaid');
        expect(invoice).toHaveProperty('status');
      }
    });

    test('available plans have correct fields', async () => {
      const request = createRequest();

      const response = await GET(request, createContext());
      const data = await response.json();

      if (data.data.availablePlans.length > 0) {
        const plan = data.data.availablePlans[0];
        expect(plan).toHaveProperty('id');
        expect(plan).toHaveProperty('name');
        expect(plan).toHaveProperty('displayName');
        expect(plan).toHaveProperty('priceMonthly');
      }
    });
  });
});

describe('POST /api/v1/admin/users/:id/billing/override', () => {
  beforeEach(() => {
    mockUser = {
      id: validUserId,
      email: 'test@example.com',
    };
    mockPlan = {
      id: validPlanId,
      name: 'pro',
      displayName: 'Pro Plan',
      priceMonthly: 2900,
    };
    mockSubscription = {
      id: 'sub_123',
      planId: 'plan-free',
      plan: {
        name: 'free',
      },
    };
    mockNewSubscription = {
      id: 'sub_new_123',
      userId: validUserId,
      planId: validPlanId,
      status: 'active',
    };
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL(`http://localhost:3001/api/v1/admin/users/${validUserId}/billing`);
      const request = new NextRequest(url, { method: 'POST' });

      const response = await POST(request, createContext());

      expect(response.status).toBe(401);
    });
  });

  describe('authorization', () => {
    test('returns 403 for non-admin users', async () => {
      const request = createRequest({
        token: 'user-token',
        method: 'POST',
        body: { planId: validPlanId },
      });

      const response = await POST(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('override plan', () => {
    test('overrides existing subscription plan', async () => {
      // Mock updated subscription for response
      mockSubscription = {
        id: 'sub_123',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        plan: mockPlan,
      };

      const request = createRequest({
        method: 'POST',
        body: { planId: validPlanId, reason: 'Promotional upgrade' },
      });

      const response = await POST(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.subscription).toBeDefined();
    });

    test('creates new subscription when user has none', async () => {
      mockSubscription = null;

      const request = createRequest({
        method: 'POST',
        body: { planId: validPlanId },
      });

      const response = await POST(request, createContext());
      const data = await response.json();

      // After creation, subscription query returns the new one
      mockSubscription = {
        id: mockNewSubscription.id,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        plan: mockPlan,
      };

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test('returns 404 for non-existent user', async () => {
      mockUser = null;
      const request = createRequest({
        method: 'POST',
        body: { planId: validPlanId },
      });

      const response = await POST(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 400 for invalid plan', async () => {
      mockPlan = null;
      const request = createRequest({
        method: 'POST',
        body: { planId: validPlanId },
      });

      const response = await POST(request, createContext());
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('BAD_REQUEST');
    });
  });
});

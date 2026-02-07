import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

let mockIdentities: any[] = [];
let mockIdentityCount = 0;
let insertValuesData: any = null;
let mockInsertedIdentity: any = null;

mock.module('@/db', () => ({
  db: {
    query: {
      identities: {
        findMany: async ({ limit, offset }: any) => {
          const start = offset || 0;
          const end = start + (limit || mockIdentities.length);
          return mockIdentities.slice(start, end);
        },
      },
    },
    select: () => ({
      from: () => ({
        where: () => [{ total: mockIdentityCount }],
      }),
    }),
    insert: (_table: any) => ({
      values: (data: any) => {
        insertValuesData = data;
        return {
          returning: () => [
            mockInsertedIdentity || {
              id: 'identity-1',
              ...data,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        };
      },
    }),
    update: (_table: any) => ({
      set: (_data: any) => ({
        where: (_condition: any) => Promise.resolve(),
      }),
    }),
  },
  schema: createSchemaMock(),
}));

mock.module('@/db/schema', () => createSchemaMock({
  identities: 'identities',
}));

mock.module('@/lib/auth/middleware', () => createAuthMiddlewareMock({
  withAuth: (handler: any) => async (req: any) => {
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
    return handler(req);
  },
}));

mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
  desc: (field: any) => ({ desc: field }),
  asc: (field: any) => ({ asc: field }),
  count: () => 'count',
  and: (...args: any[]) => ({ and: args }),
  ilike: (field: any, value: any) => ({ ilike: [field, value] }),
}));

const { GET, POST } = await import('../src/app/api/v1/identities/route');

function createGetRequest(
  params: { page?: number; limit?: number; search?: string } = {},
  options: { token?: string } = {}
): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/identities');
  if (params.page) url.searchParams.set('page', params.page.toString());
  if (params.limit) url.searchParams.set('limit', params.limit.toString());
  if (params.search) url.searchParams.set('search', params.search);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  return new NextRequest(url, { headers });
}

function createPostRequest(
  body: Record<string, unknown>,
  options: { token?: string } = {}
): NextRequest {
  const url = new URL('http://localhost:3001/api/v1/identities');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('identities API', () => {
  beforeEach(() => {
    mockIdentities = [];
    mockIdentityCount = 0;
    insertValuesData = null;
    mockInsertedIdentity = null;
  });

  test('GET returns paginated identities', async () => {
    mockIdentities = [
      { id: 'id-1', name: 'Primary', userId: 'user-123' },
      { id: 'id-2', name: 'Secondary', userId: 'user-123' },
    ];
    mockIdentityCount = 2;

    const request = createGetRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.items.length).toBe(2);
  });

  test('POST creates identity with extended contacts', async () => {
    const request = createPostRequest({
      name: 'Primary',
      title: 'Ops Lead',
      contacts: {
        emails: [{ value: 'primary@example.com', label: 'work', isPrimary: true }],
        phones: [{ value: '+1 555-0000', label: 'mobile', isPrimary: true }],
        addresses: [{
          street: '123 Main St',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701',
          country: 'USA',
          label: 'office',
        }],
        virtualAddresses: [{ value: 'matrix:@primary:server', label: 'matrix', isPrimary: true }],
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(insertValuesData.contacts.virtualAddresses.length).toBe(1);
    expect(insertValuesData.isDefault).toBe(true);
  });
});

afterAll(() => {
  mock.restore();
});

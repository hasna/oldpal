import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

let mockIdentity: any = null;
let updateSetData: any = null;
let deleteWasCalled = false;

mock.module('@/db', () => ({
  db: {
    query: {
      identities: {
        findFirst: async () => mockIdentity,
      },
    },
    update: (_table: any) => ({
      set: (data: any) => {
        updateSetData = data;
        return {
          where: (_condition: any) => ({
            returning: () => [mockIdentity ? { ...mockIdentity, ...data } : data],
          }),
        };
      },
    }),
    delete: (_table: any) => ({
      where: (_condition: any) => {
        deleteWasCalled = true;
        return Promise.resolve();
      },
    }),
  },
  schema: createSchemaMock(),
}));

mock.module('@/db/schema', () => createSchemaMock({
  identities: 'identities',
}));

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
    (req as any).user = { userId: 'user-123', email: 'test@example.com', role: 'user' };
    return handler(req, context);
  },
}));

mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
  and: (...args: any[]) => ({ and: args }),
}));

const { GET, PATCH, DELETE } = await import('../src/app/api/v1/identities/[id]/route');

function createGetRequest(
  identityId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/identities/${identityId}`);
  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }
  const request = new NextRequest(url, { headers });
  const context = { params: { id: identityId } };
  return [request, context];
}

function createPatchRequest(
  identityId: string,
  body: Record<string, unknown>,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/identities/${identityId}`);
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
  const context = { params: { id: identityId } };
  return [request, context];
}

function createDeleteRequest(
  identityId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/identities/${identityId}`);
  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }
  const request = new NextRequest(url, { headers, method: 'DELETE' });
  const context = { params: { id: identityId } };
  return [request, context];
}

describe('identities API (id)', () => {
  beforeEach(() => {
    mockIdentity = {
      id: '11111111-1111-1111-1111-111111111111',
      userId: 'user-123',
      name: 'Primary',
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
      preferences: {
        language: 'en',
        dateFormat: 'YYYY-MM-DD',
        communicationStyle: 'professional',
        responseLength: 'balanced',
        custom: {},
      },
    };
    updateSetData = null;
    deleteWasCalled = false;
  });

  test('GET returns identity', async () => {
    const [request, context] = createGetRequest(mockIdentity.id);
    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.id).toBe(mockIdentity.id);
  });

  test('PATCH merges contacts and preserves virtual addresses', async () => {
    const [request, context] = createPatchRequest(mockIdentity.id, {
      contacts: {
        phones: [{ value: '+1 555-9999', label: 'mobile', isPrimary: true }],
      },
    });
    const response = await PATCH(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(updateSetData.contacts.emails.length).toBe(1);
    expect(updateSetData.contacts.phones[0].value).toBe('+1 555-9999');
    expect(updateSetData.contacts.virtualAddresses[0].value).toBe('matrix:@primary:server');
  });

  test('PATCH merges preferences and preserves custom values', async () => {
    const [request, context] = createPatchRequest(mockIdentity.id, {
      preferences: {
        responseLength: 'concise',
      },
    });
    const response = await PATCH(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(updateSetData.preferences.responseLength).toBe('concise');
    expect(updateSetData.preferences.custom).toEqual({});
  });

  test('DELETE removes identity', async () => {
    const [request, context] = createDeleteRequest(mockIdentity.id);
    const response = await DELETE(request, context);

    expect(response.status).toBe(200);
    expect(deleteWasCalled).toBe(true);
  });
});

afterAll(() => {
  mock.restore();
});

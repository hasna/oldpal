import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock state
let mockSession: any = null;
let mockUpdatedSession: any = null;
let updateSetData: any = null;
let deleteWasCalled = false;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      sessions: {
        findFirst: async () => mockSession,
      },
    },
    update: (table: any) => ({
      set: (data: any) => {
        updateSetData = data;
        return {
          where: (condition: any) => ({
            returning: () => [mockUpdatedSession || { ...mockSession, ...data }],
          }),
        };
      },
    }),
    delete: (table: any) => ({
      where: (condition: any) => {
        deleteWasCalled = true;
        return Promise.resolve();
      },
    }),
  },
}));

// Mock db schema
mock.module('@/db/schema', () => ({
  sessions: 'sessions',
}));

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => ({
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

// Mock drizzle-orm
mock.module('drizzle-orm', () => ({
  eq: (field: any, value: any) => ({ field, value }),
  and: (...args: any[]) => ({ and: args }),
}));

const { GET, PATCH, DELETE } = await import('../src/app/api/v1/sessions/[id]/route');

function createGetRequest(
  sessionId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/sessions/${sessionId}`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { headers });
  const context = { params: { id: sessionId } };

  return [request, context];
}

function createPatchRequest(
  sessionId: string,
  body: Record<string, unknown>,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/sessions/${sessionId}`);

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
  const context = { params: { id: sessionId } };

  return [request, context];
}

function createDeleteRequest(
  sessionId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/sessions/${sessionId}`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { method: 'DELETE', headers });
  const context = { params: { id: sessionId } };

  return [request, context];
}

describe('GET /api/v1/sessions/:id', () => {
  beforeEach(() => {
    mockSession = {
      id: 'session-123',
      userId: 'user-123',
      agentId: 'agent-1',
      label: 'Test Session',
      metadata: { key: 'value' },
      createdAt: new Date(),
      agent: { id: 'agent-1', name: 'Test Agent' },
    };
    mockUpdatedSession = null;
    updateSetData = null;
    deleteWasCalled = false;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/sessions/session-123');
      const request = new NextRequest(url);
      const context = { params: { id: 'session-123' } };

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const [request, context] = createGetRequest('session-123', { token: 'invalid' });

      const response = await GET(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('session retrieval', () => {
    test('returns session with agent relation', async () => {
      const [request, context] = createGetRequest('session-123');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('session-123');
      expect(data.data.agent).toBeDefined();
      expect(data.data.agent.name).toBe('Test Agent');
    });

    test('returns 404 when session not found', async () => {
      mockSession = null;
      const [request, context] = createGetRequest('nonexistent');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when session belongs to different user', async () => {
      mockSession = { ...mockSession, userId: 'different-user' };
      const [request, context] = createGetRequest('session-123');

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });
});

describe('PATCH /api/v1/sessions/:id', () => {
  beforeEach(() => {
    mockSession = {
      id: 'session-123',
      userId: 'user-123',
      agentId: 'agent-1',
      label: 'Old Label',
      metadata: { old: 'data' },
      createdAt: new Date(),
    };
    mockUpdatedSession = null;
    updateSetData = null;
    deleteWasCalled = false;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/sessions/session-123');
      const request = new NextRequest(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'New Label' }),
      });
      const context = { params: { id: 'session-123' } };

      const response = await PATCH(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('session updates', () => {
    test('updates session label', async () => {
      const [request, context] = createPatchRequest('session-123', { label: 'New Label' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(updateSetData.label).toBe('New Label');
    });

    test('updates session metadata', async () => {
      const [request, context] = createPatchRequest('session-123', {
        metadata: { new: 'data', another: 123 },
      });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(updateSetData.metadata).toEqual({ new: 'data', another: 123 });
    });

    test('updates both label and metadata', async () => {
      const [request, context] = createPatchRequest('session-123', {
        label: 'New Label',
        metadata: { key: 'value' },
      });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(updateSetData.label).toBe('New Label');
      expect(updateSetData.metadata).toEqual({ key: 'value' });
    });

    test('sets updatedAt timestamp', async () => {
      const [request, context] = createPatchRequest('session-123', { label: 'New' });

      await PATCH(request, context);

      expect(updateSetData.updatedAt).toBeInstanceOf(Date);
    });

    test('accepts empty body (no updates)', async () => {
      const [request, context] = createPatchRequest('session-123', {});

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('authorization', () => {
    test('returns 404 when session not found', async () => {
      mockSession = null;
      const [request, context] = createPatchRequest('nonexistent', { label: 'New' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });

    test('returns 403 when session belongs to different user', async () => {
      mockSession = { ...mockSession, userId: 'different-user' };
      const [request, context] = createPatchRequest('session-123', { label: 'New' });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });

  describe('validation', () => {
    test('returns 422 when label exceeds 255 characters', async () => {
      const [request, context] = createPatchRequest('session-123', {
        label: 'a'.repeat(256),
      });

      const response = await PATCH(request, context);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

describe('DELETE /api/v1/sessions/:id', () => {
  beforeEach(() => {
    mockSession = {
      id: 'session-123',
      userId: 'user-123',
      agentId: 'agent-1',
    };
    mockUpdatedSession = null;
    updateSetData = null;
    deleteWasCalled = false;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/sessions/session-123');
      const request = new NextRequest(url, { method: 'DELETE' });
      const context = { params: { id: 'session-123' } };

      const response = await DELETE(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('session deletion', () => {
    test('deletes session and returns success', async () => {
      const [request, context] = createDeleteRequest('session-123');

      const response = await DELETE(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe('Session deleted');
      expect(deleteWasCalled).toBe(true);
    });
  });

  describe('authorization', () => {
    test('returns 404 when session not found', async () => {
      mockSession = null;
      const [request, context] = createDeleteRequest('nonexistent');

      const response = await DELETE(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
      expect(deleteWasCalled).toBe(false);
    });

    test('returns 403 when session belongs to different user', async () => {
      mockSession = { ...mockSession, userId: 'different-user' };
      const [request, context] = createDeleteRequest('session-123');

      const response = await DELETE(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
      expect(deleteWasCalled).toBe(false);
    });
  });
});

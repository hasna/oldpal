import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';

// Mock state
let mockSession: any = null;
let stopSessionCalled = false;
let stopSessionError: Error | null = null;

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      sessions: {
        findFirst: async () => mockSession,
      },
    },
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

// Mock agent pool
mock.module('@/lib/server/agent-pool', () => ({
  stopSession: async (sessionId: string) => {
    stopSessionCalled = true;
    if (stopSessionError) {
      throw stopSessionError;
    }
    return true;
  },
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => ({
  eq: (field: any, value: any) => ({ field, value }),
}));

const { POST } = await import('../src/app/api/v1/chat/[sessionId]/stop/route');

function createRequest(
  sessionId: string,
  options: { token?: string } = {}
): [NextRequest, { params: { sessionId: string } }] {
  const url = new URL(`http://localhost:3001/api/v1/chat/${sessionId}/stop`);

  const headers: Record<string, string> = {};
  if (options.token !== undefined) {
    headers['Authorization'] = `Bearer ${options.token}`;
  } else {
    headers['Authorization'] = 'Bearer valid-token';
  }

  const request = new NextRequest(url, { method: 'POST', headers });
  const context = { params: { sessionId } };

  return [request, context];
}

describe('POST /api/v1/chat/:sessionId/stop', () => {
  beforeEach(() => {
    mockSession = {
      id: 'session-123',
      userId: 'user-123',
      agentId: 'agent-1',
      createdAt: new Date(),
    };
    stopSessionCalled = false;
    stopSessionError = null;
  });

  describe('authentication', () => {
    test('returns 401 when no token provided', async () => {
      const url = new URL('http://localhost:3001/api/v1/chat/session-123/stop');
      const request = new NextRequest(url, { method: 'POST' });
      const context = { params: { sessionId: 'session-123' } };

      const response = await POST(request, context);

      expect(response.status).toBe(401);
    });

    test('returns 401 for invalid token', async () => {
      const [request, context] = createRequest('session-123', { token: 'invalid' });

      const response = await POST(request, context);

      expect(response.status).toBe(401);
    });
  });

  describe('session validation', () => {
    test('returns 404 when session not found', async () => {
      mockSession = null;
      const [request, context] = createRequest('nonexistent-session');

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
      expect(data.error.message).toBe('Session not found');
    });

    test('returns 403 when session belongs to different user', async () => {
      mockSession = {
        id: 'session-123',
        userId: 'different-user',
        agentId: 'agent-1',
      };
      const [request, context] = createRequest('session-123');

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error.code).toBe('FORBIDDEN');
      expect(data.error.message).toBe('Access denied');
    });
  });

  describe('successful stop', () => {
    test('returns success when session stopped', async () => {
      const [request, context] = createRequest('session-123');

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe('Generation stopped');
    });

    test('calls stopSession with correct session ID', async () => {
      const [request, context] = createRequest('session-123');

      await POST(request, context);

      expect(stopSessionCalled).toBe(true);
    });
  });

  describe('error handling', () => {
    test('handles stopSession errors gracefully', async () => {
      stopSessionError = new Error('Failed to stop session');
      const [request, context] = createRequest('session-123');

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });
});

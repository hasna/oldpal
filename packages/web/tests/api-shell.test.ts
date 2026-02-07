import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { setMockBashExecutor } from './helpers/mock-assistants-core';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

let mockSession: any = null;
let lastBashInput: any = null;

mock.module('@/db', () => ({
  db: {
    query: {
      sessions: {
        findFirst: async () => mockSession,
      },
    },
  },
  schema: createSchemaMock(),
}));

mock.module('@/db/schema', () => createSchemaMock({
  sessions: 'sessions',
}));

mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
  and: (...args: any[]) => ({ and: args }),
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

const { POST } = await import('../src/app/api/v1/shell/route');

function createRequest(body: Record<string, unknown>, token: string | undefined = 'valid-token'): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new NextRequest('http://localhost/api/v1/shell', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/shell', () => {
  beforeEach(() => {
    mockSession = null;
    lastBashInput = null;
    setMockBashExecutor(async (input) => {
      lastBashInput = input;
      return 'Command completed successfully (no output)';
    });
  });

  test('returns 401 when missing auth', async () => {
    const request = createRequest({ command: 'ls' }, undefined);
    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  test('runs bash tool and returns output', async () => {
    mockSession = { cwd: '/tmp/project' };
    setMockBashExecutor(async (input) => {
      lastBashInput = input;
      return 'hello-world';
    });

    const request = createRequest({ command: 'ls', sessionId: 'session-1' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.ok).toBe(true);
    expect(data.data.stdout).toBe('hello-world');
    expect(lastBashInput).toEqual({ command: 'ls', cwd: '/tmp/project', sessionId: 'session-1' });
  });

  test('captures bash errors and exit code', async () => {
    setMockBashExecutor(async () => {
      throw new Error('Exit code 2\nboom');
    });

    const request = createRequest({ command: 'ls' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.ok).toBe(false);
    expect(data.data.exitCode).toBe(2);
    expect(data.data.stderr).toBe('boom');
  });

  test('defaults to process cwd when session not found', async () => {
    mockSession = null;
    const request = createRequest({ command: 'pwd', sessionId: 'session-404' });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(lastBashInput.command).toBe('pwd');
    expect(lastBashInput.cwd).toBe(process.cwd());
  });

  test('returns validation error for missing command', async () => {
    const request = createRequest({});
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });
});

afterAll(() => {
  mock.restore();
});

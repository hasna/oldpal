import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

let mockSession: any = null;
let lastSpawnArgs: { command: string; options: Record<string, unknown> } | null = null;
let spawnConfig: { stdout: string; stderr: string; exitCode: number | null; error?: Error } = {
  stdout: 'Command completed successfully (no output)',
  stderr: '',
  exitCode: 0,
};

function createMockProcess() {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};

  const emit = (event: string, ...args: any[]) => {
    (listeners[event] || []).forEach((handler) => handler(...args));
  };

  queueMicrotask(() => {
    if (spawnConfig.stdout) {
      stdout.emit('data', Buffer.from(spawnConfig.stdout));
    }
    stdout.emit('end');
    if (spawnConfig.stderr) {
      stderr.emit('data', Buffer.from(spawnConfig.stderr));
    }
    stderr.emit('end');
    if (spawnConfig.error) {
      emit('error', spawnConfig.error);
      return;
    }
    emit('close', spawnConfig.exitCode);
  });

  return {
    stdout,
    stderr,
    on: (event: string, handler: (...args: any[]) => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
      return undefined;
    },
  };
}

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

mock.module('child_process', () => ({
  spawn: (command: string, options: Record<string, unknown>) => {
    lastSpawnArgs = { command, options };
    return createMockProcess();
  },
}));

const { POST } = await import('../src/app/api/v1/shell/route');

function createRequest(body: Record<string, unknown>, token?: string): NextRequest {
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
    lastSpawnArgs = null;
    spawnConfig = { stdout: 'Command completed successfully (no output)', stderr: '', exitCode: 0 };
  });

  test('returns 401 when missing auth', async () => {
    const request = createRequest({ command: 'ls' });
    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  test('runs bash tool and returns output', async () => {
    mockSession = { cwd: '/tmp/project' };
    spawnConfig = { stdout: 'hello-world', stderr: '', exitCode: 0 };

    const request = createRequest({ command: 'ls', sessionId: '5caa171b-2f40-4a38-9ea7-2b2a90b15a39' }, 'valid-token');
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.ok).toBe(true);
    expect(data.data.stdout).toBe('hello-world');
    expect(lastSpawnArgs?.command).toBe('ls');
    expect(lastSpawnArgs?.options.cwd).toBe('/tmp/project');
  });

  test('captures bash errors and exit code', async () => {
    spawnConfig = { stdout: '', stderr: 'boom', exitCode: 2 };

    const request = createRequest({ command: 'ls' }, 'valid-token');
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
    const request = createRequest({ command: 'pwd', sessionId: '7b5c8c8a-273d-4f20-86a8-16b64bf84077' }, 'valid-token');
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(lastSpawnArgs?.command).toBe('pwd');
    expect(lastSpawnArgs?.options.cwd).toBe(process.cwd());
  });

  test('returns validation error for missing command', async () => {
    const request = createRequest({}, 'valid-token');
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

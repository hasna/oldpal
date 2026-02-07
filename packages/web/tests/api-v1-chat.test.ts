import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { NextRequest } from 'next/server';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';
import { createSchemaMock } from './helpers/mock-schema';
import { createAuthMiddlewareMock } from './helpers/mock-auth-middleware';

// Mock state
let mockUser: { userId: string; role: string } | null = null;
let mockSessions: Map<string, { id: string; userId: string; label: string }> = new Map();
let mockMessages: Array<{ sessionId: string; userId: string; role: string; content: string; toolCalls?: unknown[]; toolResults?: unknown[] }> = [];
let mockChunkCallback: ((chunk: any) => void) | null = null;
let mockErrorCallback: ((error: Error) => void) | null = null;
let mockSentMessages: string[] = [];
let mockInsertedSessions: Array<{ userId: string; label: string }> = [];

// Mock auth middleware
mock.module('@/lib/auth/middleware', () => createAuthMiddlewareMock({
  getAuthUser: async () => mockUser,
}));

// Mock database
mock.module('@/db', () => ({
  db: {
    query: {
      sessions: {
        findFirst: async ({ where }: any) => {
          // Find session from mock data
          for (const [id, session] of mockSessions) {
            return session;
          }
          return null;
        },
      },
    },
    insert: (table: any) => ({
      values: (data: any) => {
        if (table === 'sessions') {
          mockInsertedSessions.push(data);
          return {
            returning: () => [{ id: 'new-session-id', ...data }],
          };
        }
        if (table === 'messages') {
          mockMessages.push(data);
        }
        return { returning: () => [data] };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  },
  schema: createSchemaMock(),
}));

// Mock drizzle-orm
mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
}));

// Mock db schema
mock.module('@/db/schema', () => createSchemaMock({
  sessions: 'sessions',
  messages: 'messages',
}));

// Mock assistant-pool
mock.module('@/lib/server/agent-pool', () => ({
  subscribeToSession: async (
    sessionId: string,
    onChunk: (chunk: any) => void,
    onError: (error: Error) => void
  ) => {
    mockChunkCallback = onChunk;
    mockErrorCallback = onError;
    return () => {
      mockChunkCallback = null;
      mockErrorCallback = null;
    };
  },
  sendSessionMessage: async (sessionId: string, message: string) => {
    mockSentMessages.push(message);
  },
  stopSession: async () => {},
}));

const { POST } = await import('../src/app/api/v1/chat/route');

function createRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('api v1 chat route', () => {
  beforeEach(() => {
    mockUser = null;
    mockSessions.clear();
    mockMessages = [];
    mockChunkCallback = null;
    mockErrorCallback = null;
    mockSentMessages = [];
    mockInsertedSessions = [];
  });

  test('returns 401 when not authenticated', async () => {
    mockUser = null;
    const request = createRequest({ message: 'Hello' });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  test('returns 422 when message is missing', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({});
    const response = await POST(request);
    expect(response.status).toBe(422);
  });

  test('returns 422 when message is empty', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: '' });
    const response = await POST(request);
    expect(response.status).toBe(422);
  });

  test('returns 422 when sessionId is invalid UUID', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: 'Hello', sessionId: 'not-a-uuid' });
    const response = await POST(request);
    expect(response.status).toBe(422);
  });

  test('streams response with correct headers', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: 'Hello' });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    expect(response.headers.get('X-Session-Id')).toBeTruthy();
  });

  test('sends message to session', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: 'Hello AI' });

    await POST(request);

    // Give async operations time to execute
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSentMessages).toContain('Hello AI');
  });

  test('streams text delta chunks as SSE', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: 'Hello' });
    const response = await POST(request);

    // Emit a text chunk
    mockChunkCallback?.({ type: 'text', content: 'Hello there!' });
    mockChunkCallback?.({ type: 'done' });

    const text = await response.text();
    expect(text).toContain('text_delta');
    expect(text).toContain('Hello there!');
    expect(text).toContain('message_complete');
  });

  test('streams tool call chunks', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: 'Read file' });
    const response = await POST(request);

    mockChunkCallback?.({
      type: 'tool_use',
      toolCall: { id: 'tc-1', name: 'read_file', input: { path: '/test.txt' } }
    });
    mockChunkCallback?.({ type: 'done' });

    const text = await response.text();
    expect(text).toContain('tool_call');
    expect(text).toContain('read_file');
  });

  test('streams tool result chunks', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: 'Read file' });
    const response = await POST(request);

    mockChunkCallback?.({
      type: 'tool_result',
      toolResult: { toolCallId: 'tc-1', content: 'file contents', isError: false }
    });
    mockChunkCallback?.({ type: 'done' });

    const text = await response.text();
    expect(text).toContain('tool_result');
    expect(text).toContain('file contents');
  });

  test('streams error chunks', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: 'Hello' });
    const response = await POST(request);

    mockChunkCallback?.({ type: 'error', error: 'Something went wrong' });
    mockChunkCallback?.({ type: 'done' });

    const text = await response.text();
    expect(text).toContain('error');
    expect(text).toContain('Something went wrong');
  });

  test('handles error callback from session', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: 'Hello' });
    const response = await POST(request);

    mockErrorCallback?.(new Error('Session error'));

    const text = await response.text();
    expect(text).toContain('error');
    expect(text).toContain('Session error');
  });

  test('saves user message to database', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: 'Test message' });

    await POST(request);
    await new Promise(resolve => setTimeout(resolve, 10));

    const userMessage = mockMessages.find(m => m.role === 'user');
    expect(userMessage).toBeDefined();
    expect(userMessage?.content).toBe('Test message');
    expect(userMessage?.userId).toBe('user-1');
  });

  test('creates new session when sessionId not provided', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const request = createRequest({ message: 'New conversation' });

    const response = await POST(request);

    expect(mockInsertedSessions.length).toBeGreaterThan(0);
    expect(mockInsertedSessions[0].userId).toBe('user-1');
  });

  test('truncates long messages in session label', async () => {
    mockUser = { userId: 'user-1', role: 'user' };
    const longMessage = 'A'.repeat(100);
    const request = createRequest({ message: longMessage });

    await POST(request);

    expect(mockInsertedSessions[0].label.length).toBeLessThanOrEqual(53); // 50 + "..."
  });
});

afterAll(() => {
  mock.restore();
});

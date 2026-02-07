import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import type { ClientMessage } from '../src/lib/protocol';
import { resetMockClients } from './helpers/mock-assistants-core';
import { createSchemaMock } from './helpers/mock-schema';

class MockWebSocketServer {
  public handlers: Record<string, any> = {};
  constructor(public options: any) {}
  on(event: string, cb: any) {
    this.handlers[event] = cb;
  }
  triggerConnection(ws: any, req?: any) {
    this.handlers.connection?.(ws, req || { headers: {}, url: '/' });
  }
}

const sessionId = '11111111-1111-1111-1111-111111111111';
const sessionId2 = '22222222-2222-2222-2222-222222222222';

mock.module('ws', () => ({
  WebSocketServer: MockWebSocketServer,
}));

// Mock database module
mock.module('@/db', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => ({ isActive: true }),
      },
      sessions: {
        findFirst: async () => null, // Session doesn't exist, will be created
      },
    },
    insert: () => ({
      values: () => ({
        returning: async () => [{}],
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {},
      }),
    }),
  },
  schema: createSchemaMock(),
}));

mock.module('@/db/schema', () => createSchemaMock({
  users: {},
  sessions: {},
  messages: {},
}));

// Mock assistant-pool to avoid loading real database and core dependencies
const mockAssistantPool = {
  subscribers: new Map<string, { onChunk: Function; onError?: Function }>(),
  lastMessage: null as string | null,
  stopped: new Set<string>(),

  subscribeToSession: async (sessionId: string, onChunk: Function, onError?: Function) => {
    mockAssistantPool.subscribers.set(sessionId, { onChunk, onError });
    return () => {
      mockAssistantPool.subscribers.delete(sessionId);
    };
  },

  sendSessionMessage: async (sessionId: string, message: string) => {
    mockAssistantPool.lastMessage = message;
    // Emit a text chunk to the subscriber
    const sub = mockAssistantPool.subscribers.get(sessionId);
    if (sub) {
      sub.onChunk({ type: 'text', content: 'response' });
    }
  },

  stopSession: async (sessionId: string) => {
    mockAssistantPool.stopped.add(sessionId);
  },
};

mock.module('@/lib/server/agent-pool', () => mockAssistantPool);

const handler = (await import('../src/pages/api/v1/ws')).default;

function createRes() {
  return {
    socket: { server: {} as any },
    end: () => {},
  } as any;
}

describe('pages api ws handler', () => {
  beforeEach(() => {
    resetMockClients();
    // Reset mock assistant pool state
    mockAssistantPool.lastMessage = null;
    mockAssistantPool.stopped.clear();
    mockAssistantPool.subscribers.clear();
  });

  test('initializes WebSocket server and handles messages', async () => {
    const req = {} as any;
    const res = createRes();

    handler(req, res);
    const wss = res.socket.server.wss as MockWebSocketServer;

    const sent: string[] = [];
    const ws = {
      handlers: {} as Record<string, any>,
      send: (msg: string) => sent.push(msg),
      close: (_code?: number, _reason?: string) => {},
      on: function (event: string, cb: any) { this.handlers[event] = cb; },
    };

    wss.triggerConnection(ws);

    const message: ClientMessage = { type: 'message', content: 'Hi', messageId: 'msg-1', sessionId };
    await ws.handlers.message(JSON.stringify(message));
    // Verify message was sent to the assistant pool
    expect(mockAssistantPool.lastMessage).toBe('Hi');

    // The mock assistant pool emits a text_delta when sendSessionMessage is called
    expect(sent.some((payload) => payload.includes('text_delta'))).toBe(true);

    await ws.handlers.message('not-json');
    expect(sent.some((payload) => payload.includes('\"error\"'))).toBe(true);
  });

  test('cancel message calls stopSession', async () => {
    const req = {} as any;
    const res = createRes();
    handler(req, res);
    const wss = res.socket.server.wss as MockWebSocketServer;

    const ws = {
      handlers: {} as Record<string, any>,
      send: (_msg: string) => {},
      close: (_code?: number, _reason?: string) => {},
      on: function (event: string, cb: any) { this.handlers[event] = cb; },
    };

    wss.triggerConnection(ws);
    const switchMessage: ClientMessage = { type: 'message', content: 'Ping', sessionId: sessionId2 };
    await ws.handlers.message(JSON.stringify(switchMessage));

    const cancel: ClientMessage = { type: 'cancel' };
    await ws.handlers.message(JSON.stringify(cancel));
    // Verify stopSession was called for the session
    expect(mockAssistantPool.stopped.has(sessionId2)).toBe(true);
  });
});

afterAll(() => {
  mock.restore();
});

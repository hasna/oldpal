import { describe, expect, test, beforeEach, mock } from 'bun:test';
import type { ClientMessage } from '../src/lib/protocol';
import { resetMockClients } from './helpers/mock-assistants-core';

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
}));

mock.module('@/db/schema', () => ({
  users: {},
  sessions: {},
  messages: {},
}));

// Mock agent-pool to avoid loading real database and core dependencies
const mockAgentPool = {
  subscribers: new Map<string, { onChunk: Function; onError?: Function }>(),
  lastMessage: null as string | null,
  stopped: new Set<string>(),

  subscribeToSession: async (sessionId: string, onChunk: Function, onError?: Function) => {
    mockAgentPool.subscribers.set(sessionId, { onChunk, onError });
    return () => {
      mockAgentPool.subscribers.delete(sessionId);
    };
  },

  sendSessionMessage: async (sessionId: string, message: string) => {
    mockAgentPool.lastMessage = message;
    // Emit a text chunk to the subscriber
    const sub = mockAgentPool.subscribers.get(sessionId);
    if (sub) {
      sub.onChunk({ type: 'text', content: 'response' });
    }
  },

  stopSession: async (sessionId: string) => {
    mockAgentPool.stopped.add(sessionId);
  },
};

mock.module('@/lib/server/agent-pool', () => mockAgentPool);

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
    // Reset mock agent pool state
    mockAgentPool.lastMessage = null;
    mockAgentPool.stopped.clear();
    mockAgentPool.subscribers.clear();
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
      on: function (event: string, cb: any) { this.handlers[event] = cb; },
    };

    wss.triggerConnection(ws);

    const message: ClientMessage = { type: 'message', content: 'Hi', messageId: 'msg-1', sessionId: 'ws-test-1' };
    await ws.handlers.message(JSON.stringify(message));
    // Verify message was sent to the agent pool
    expect(mockAgentPool.lastMessage).toBe('Hi');

    // The mock agent pool emits a text_delta when sendSessionMessage is called
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
      on: function (event: string, cb: any) { this.handlers[event] = cb; },
    };

    wss.triggerConnection(ws);
    const switchMessage: ClientMessage = { type: 'message', content: 'Ping', sessionId: 'ws-test-2' };
    await ws.handlers.message(JSON.stringify(switchMessage));

    const cancel: ClientMessage = { type: 'cancel' };
    await ws.handlers.message(JSON.stringify(cancel));
    // Verify stopSession was called for the session
    expect(mockAgentPool.stopped.has('ws-test-2')).toBe(true);
  });
});

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import type { ClientMessage } from '../src/lib/protocol';
import { getMockClients, resetMockClients } from './helpers/mock-assistants-core';

class MockWebSocketServer {
  public handlers: Record<string, any> = {};
  constructor(public options: any) {}
  on(event: string, cb: any) {
    this.handlers[event] = cb;
  }
  triggerConnection(ws: any) {
    this.handlers.connection?.(ws);
  }
}

mock.module('ws', () => ({
  WebSocketServer: MockWebSocketServer,
}));

const handler = (await import('../src/pages/api/ws')).default;

function createRes() {
  return {
    socket: { server: {} as any },
    end: () => {},
  } as any;
}

describe('pages api ws handler', () => {
  beforeEach(() => {
    resetMockClients();
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
    expect(getMockClients().at(-1)!.sent[0]).toBe('Hi');

    getMockClients().at(-1)!.emitChunk({ type: 'text', content: 'hello' });
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
    expect(getMockClients().at(-1)!.stopped).toBe(true);
  });
});

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { chatWs } from '../src/lib/ws';
import { useChatStore } from '../src/lib/store';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    currentToolCalls: [],
    currentStreamMessageId: null,
    sessionId: null,
    sessions: [],
    sessionSnapshots: {},
  });
  (globalThis as any).WebSocket = MockWebSocket;
  MockWebSocket.instances = [];
  (chatWs as any).maxReconnectAttempts = 5;
  (chatWs as any).reconnectAttempts = 0;
  (chatWs as any).shouldReconnect = true;
});

afterEach(() => {
  chatWs.disconnect();
  (globalThis as any).WebSocket = originalWebSocket;
});

describe('ChatWebSocket', () => {
  test('connect creates a session and handles streaming text', () => {
    chatWs.connect('ws://test');
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();

    const state = useChatStore.getState();
    expect(state.sessionId).toBeTruthy();
    expect(ws.sent.some((data) => JSON.parse(data).type === 'session')).toBe(true);

    useChatStore.getState().addMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });

    ws.onmessage?.({ data: JSON.stringify({ type: 'text_delta', content: 'hello' }) });
    const updated = useChatStore.getState();
    expect(updated.messages.at(-1)?.content).toBe('hello');
  });

  test('handles tool calls and results', () => {
    chatWs.connect('ws://test');
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();

    useChatStore.getState().addMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'tool_call',
        id: 'tool-1',
        name: 'read',
        input: { path: 'notes.txt' },
      }),
    });

    let state = useChatStore.getState();
    expect(state.currentToolCalls.length).toBe(1);

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'tool_result',
        id: 'tool-1',
        output: 'ok',
        isError: false,
      }),
    });

    state = useChatStore.getState();
    expect(state.currentToolCalls[0]?.result?.content).toBe('ok');

    ws.onmessage?.({
      data: JSON.stringify({ type: 'message_complete' }),
    });

    const finalized = useChatStore.getState();
    const last = finalized.messages.at(-1);
    expect(last?.toolCalls?.length).toBe(1);
    expect(last?.toolResults?.[0]?.content).toBe('ok');
  });

  test('surfaces error messages in the assistant stream', () => {
    chatWs.connect('ws://test');
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();

    useChatStore.getState().addMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });

    ws.onmessage?.({
      data: JSON.stringify({ type: 'error', message: 'boom', messageId: 'assistant-1' }),
    });

    const state = useChatStore.getState();
    expect(state.messages.at(-1)?.content).toContain('[Error: boom]');
    expect(state.isStreaming).toBe(false);
  });

  test('queues outgoing messages until connected', () => {
    chatWs.connect('ws://test');
    const ws = MockWebSocket.instances[0];
    ws.readyState = MockWebSocket.CLOSED;
    chatWs.send({ type: 'ping' } as any);
    expect((chatWs as any).pending.length).toBe(1);

    const ws2 = MockWebSocket.instances[1];
    ws2.onopen?.();
    expect((chatWs as any).pending.length).toBe(0);
    expect(ws2.sent.some((data) => JSON.parse(data).type === 'ping')).toBe(true);
  });

  test('send immediately uses open connection', () => {
    chatWs.connect('ws://test');
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();

    chatWs.send({ type: 'ping' } as any);
    expect(ws.sent.some((data) => JSON.parse(data).type === 'ping')).toBe(true);
    expect((chatWs as any).pending.length).toBe(0);
  });

  test('disconnect prevents reconnect and clears pending', () => {
    chatWs.connect('ws://test');
    (chatWs as any).pending = [{ type: 'ping' }];
    chatWs.disconnect();
    expect((chatWs as any).pending.length).toBe(0);
    expect((chatWs as any).shouldReconnect).toBe(false);
  });

  test('stops reconnecting after max attempts', () => {
    chatWs.connect('ws://test');
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();

    useChatStore.getState().addMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });
    useChatStore.getState().addToolCall({ id: 'tool-1', name: 'read', input: {}, type: 'tool' });
    useChatStore.getState().setStreaming(true);

    (chatWs as any).maxReconnectAttempts = 0;
    ws.onclose?.();

    const state = useChatStore.getState();
    expect(state.isStreaming).toBe(false);
    expect(state.currentToolCalls.length).toBe(0);
  });

  test('ignores malformed server messages', () => {
    chatWs.connect('ws://test');
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();

    expect(() => ws.onmessage?.({ data: '{bad json' })).not.toThrow();
  });

  test('reconnect timer callback triggers a new connection', () => {
    const originalSetTimeout = globalThis.setTimeout;
    let callback: (() => void) | null = null;
    globalThis.setTimeout = ((cb: () => void) => {
      callback = cb;
      return 1 as any;
    }) as any;

    chatWs.connect('ws://test');
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    ws.onclose?.();
    callback?.();

    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    globalThis.setTimeout = originalSetTimeout;
  });

  test('handleMessage ignores unknown types and disconnect is safe', () => {
    (chatWs as any).handleMessage({ type: 'unknown' });
    chatWs.disconnect();
  });
});

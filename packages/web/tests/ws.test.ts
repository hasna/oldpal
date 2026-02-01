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
});

import { describe, expect, test, beforeEach } from 'bun:test';
import { useChatStore } from '../src/lib/store';

describe('chat store', () => {
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
  });

  test('creates a new session and switches', () => {
    const id = useChatStore.getState().createSession('Alpha');
    const state = useChatStore.getState();
    expect(state.sessionId).toBe(id);
    expect(state.sessions.length).toBe(1);

    const id2 = useChatStore.getState().createSession('Beta');
    const state2 = useChatStore.getState();
    expect(state2.sessionId).toBe(id2);
    expect(state2.sessions.length).toBe(2);
  });

  test('switchSession preserves messages per session', () => {
    const id = useChatStore.getState().createSession('One');
    useChatStore.getState().addMessage({ id: 'm1', role: 'user', content: 'hi', timestamp: Date.now() });

    const id2 = useChatStore.getState().createSession('Two');
    useChatStore.getState().addMessage({ id: 'm2', role: 'assistant', content: 'yo', timestamp: Date.now() });

    useChatStore.getState().switchSession(id);
    expect(useChatStore.getState().messages.find((m) => m.id === 'm1')).toBeTruthy();

    useChatStore.getState().switchSession(id2);
    expect(useChatStore.getState().messages.find((m) => m.id === 'm2')).toBeTruthy();
  });

  test('createSession snapshots the previous session', () => {
    const id = useChatStore.getState().createSession('First');
    useChatStore.getState().addMessage({ id: 'm1', role: 'user', content: 'hi', timestamp: Date.now() });

    const id2 = useChatStore.getState().createSession('Second');
    expect(useChatStore.getState().sessionId).toBe(id2);
    expect(useChatStore.getState().messages.length).toBe(0);

    useChatStore.getState().switchSession(id);
    expect(useChatStore.getState().messages.find((m) => m.id === 'm1')).toBeTruthy();
  });

  test('createSession uses default label when none provided', () => {
    const id = useChatStore.getState().createSession();
    const state = useChatStore.getState();
    const session = state.sessions.find((s) => s.id === id);
    expect(session?.label).toBe('Session 1');
  });

  test('appendMessageContent updates by id or creates new assistant message', () => {
    useChatStore.getState().createSession('One');
    useChatStore.getState().addMessage({ id: 'm1', role: 'assistant', content: 'hi', timestamp: Date.now() });
    useChatStore.getState().appendMessageContent('m1', ' there');
    expect(useChatStore.getState().messages.at(-1)?.content).toBe('hi there');

    useChatStore.getState().addMessage({ id: 'm3', role: 'assistant', content: 'second', timestamp: Date.now() });
    useChatStore.getState().appendMessageContent('m3', ' msg');
    expect(useChatStore.getState().messages.find((m) => m.id === 'm3')?.content).toBe('second msg');

    useChatStore.getState().addMessage({ id: 'm2', role: 'user', content: 'yo', timestamp: Date.now() });
    useChatStore.getState().appendMessageContent(undefined, 'new');
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.content).toBe('new');
  });

  test('addToolCall falls back to the last assistant message', () => {
    useChatStore.getState().createSession('One');
    useChatStore.getState().addMessage({ id: 'm1', role: 'assistant', content: '', timestamp: Date.now() });

    useChatStore.getState().addToolCall({ id: 't1', name: 'bash', input: {}, type: 'tool' });
    const state = useChatStore.getState();

    expect(state.currentToolCalls.length).toBe(1);
    expect(state.currentStreamMessageId).toBe('m1');
  });

  test('addToolCall finds most recent assistant when no stream id', () => {
    useChatStore.getState().createSession('One');
    useChatStore.getState().addMessage({ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() });
    useChatStore.getState().addMessage({ id: 'a1', role: 'assistant', content: '', timestamp: Date.now() });
    useChatStore.getState().addToolCall({ id: 't2', name: 'read', input: {}, type: 'tool' });
    expect(useChatStore.getState().currentStreamMessageId).toBe('a1');
  });

  test('addToolCall resets tool calls when message id changes', () => {
    useChatStore.getState().createSession('One');
    useChatStore.getState().addMessage({ id: 'm1', role: 'assistant', content: '', timestamp: Date.now() });
    useChatStore.getState().addMessage({ id: 'm2', role: 'assistant', content: '', timestamp: Date.now() });

    useChatStore.getState().addToolCall({ id: 't1', name: 'bash', input: {}, type: 'tool' }, 'm1');
    useChatStore.getState().addToolCall({ id: 't2', name: 'bash', input: {}, type: 'tool' }, 'm2');
    const state = useChatStore.getState();
    expect(state.currentToolCalls.length).toBe(1);
    expect(state.currentToolCalls[0].id).toBe('t2');
  });

  test('updateToolResult attaches result to tool call', () => {
    useChatStore.getState().createSession('One');
    useChatStore.getState().addMessage({ id: 'm1', role: 'assistant', content: '', timestamp: Date.now() });
    useChatStore.getState().addToolCall({ id: 't1', name: 'read', input: {}, type: 'tool' }, 'm1');
    useChatStore.getState().updateToolResult('t1', { toolCallId: 't1', content: 'ok', isError: false });
    const state = useChatStore.getState();
    expect(state.currentToolCalls[0].result?.content).toBe('ok');
  });

  test('finalizeToolCalls attaches tool results to last assistant message', () => {
    useChatStore.getState().createSession('One');
    useChatStore.getState().addMessage({ id: 'm1', role: 'assistant', content: '', timestamp: Date.now() });
    useChatStore.getState().addToolCall({ id: 't1', name: 'read', input: {}, type: 'tool' }, 'm1');
    useChatStore.getState().updateToolResult('t1', { toolCallId: 't1', content: 'done', isError: false });
    useChatStore.getState().finalizeToolCalls('m1');
    const message = useChatStore.getState().messages.at(-1);
    expect(message?.toolCalls?.length).toBe(1);
    expect(message?.toolResults?.[0]?.content).toBe('done');
  });

  test('clearToolCalls resets tool call state', () => {
    useChatStore.getState().createSession('One');
    useChatStore.getState().addToolCall({ id: 't1', name: 'bash', input: {}, type: 'tool' });
    useChatStore.getState().clearToolCalls();
    expect(useChatStore.getState().currentToolCalls.length).toBe(0);
    expect(useChatStore.getState().currentStreamMessageId).toBeNull();
  });

  test('finalizeToolCalls clears stream id when no tool calls', () => {
    useChatStore.getState().createSession('One');
    useChatStore.setState({ currentStreamMessageId: 'm1' });

    useChatStore.getState().finalizeToolCalls();
    expect(useChatStore.getState().currentStreamMessageId).toBeNull();
  });

  test('clearMessages resets stream id', () => {
    useChatStore.getState().createSession('One');
    useChatStore.setState({ currentStreamMessageId: 'm1' });

    useChatStore.getState().clearMessages();
    expect(useChatStore.getState().currentStreamMessageId).toBeNull();
  });

  test('setSessionId and setStreaming update state', () => {
    useChatStore.getState().setSessionId('session-x');
    useChatStore.getState().setStreaming(true);
    const state = useChatStore.getState();
    expect(state.sessionId).toBe('session-x');
    expect(state.isStreaming).toBe(true);
  });
});

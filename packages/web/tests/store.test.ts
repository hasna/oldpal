import { describe, expect, test, beforeEach } from 'bun:test';
import { useChatStore } from '../src/lib/store';

describe('chat store', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      currentToolCalls: [],
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
});

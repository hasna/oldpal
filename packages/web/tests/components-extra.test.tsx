import React from 'react';
import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { useChatStore } from '../src/lib/store';
import { chatWs } from '../src/lib/ws';
import { Input } from '../src/components/ui/Input';
import { MessageBubble } from '../src/components/chat/MessageBubble';
import { MessageList } from '../src/components/chat/MessageList';
import type { ToolCall, ToolResult, Message } from '@hasna/assistants-shared';

const sent: any[] = [];
const connected: string[] = [];
let disconnects = 0;

const { Header } = await import('../src/components/shared/Header');
const { Sidebar } = await import('../src/components/shared/Sidebar');
const { CommandPalette } = await import('../src/components/shared/CommandPalette');
const { InputArea } = await import('../src/components/chat/InputArea');
const { ChatContainer } = await import('../src/components/chat/ChatContainer');
const { MarkdownRenderer } = await import('../src/components/chat/MarkdownRenderer');
const { ServiceWorker } = await import('../src/components/shared/ServiceWorker');

async function renderWithAct(element: React.ReactElement) {
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(element);
  });
  return renderer!;
}

const createWindowStub = () => {
  const listeners: Record<string, Array<(event: any) => void>> = {};
  const addEventListener = (event: string, cb: (evt: any) => void) => {
    listeners[event] = listeners[event] || [];
    listeners[event].push(cb);
  };
  const removeEventListener = (event: string, cb: (evt: any) => void) => {
    listeners[event] = (listeners[event] || []).filter((handler) => handler !== cb);
  };

  (globalThis as any).window = {
    addEventListener,
    removeEventListener,
    location: { protocol: 'http:', host: 'example.com' },
  };

  return {
    listeners,
  };
};

describe('web extra components', () => {
  let originalWindow: any;
  let originalNavigator: any;
  let originalCrypto: any;
  let originalChatWs: { send: any; connect: any; disconnect: any } | null = null;

  beforeEach(() => {
    sent.length = 0;
    connected.length = 0;
    disconnects = 0;

    if (!originalChatWs) {
      originalChatWs = {
        send: chatWs.send,
        connect: chatWs.connect,
        disconnect: chatWs.disconnect,
      };
    }

    chatWs.send = ((msg: any) => sent.push(msg)) as any;
    chatWs.connect = ((url: string) => connected.push(url)) as any;
    chatWs.disconnect = (() => { disconnects += 1; }) as any;

    useChatStore.setState({
      messages: [],
      isStreaming: false,
      currentToolCalls: [],
      currentStreamMessageId: null,
      sessionId: null,
      sessions: [],
      sessionSnapshots: {},
    });

    originalWindow = (globalThis as any).window;
    originalNavigator = (globalThis as any).navigator;
    originalCrypto = (globalThis as any).crypto;
  });

  afterEach(() => {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      (globalThis as any).window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        location: { protocol: 'http:', host: 'example.com' },
      };
    }
    (globalThis as any).navigator = originalNavigator;
    (globalThis as any).crypto = originalCrypto;
    if (originalChatWs) {
      chatWs.send = originalChatWs.send;
      chatWs.connect = originalChatWs.connect;
      chatWs.disconnect = originalChatWs.disconnect;
    }
  });

  test('Header starts a new session and sends cancel when streaming', async () => {
    (globalThis as any).crypto = { randomUUID: () => 'session-2' };
    useChatStore.setState({ isStreaming: true, sessionId: 'session-1' });

    const renderer = await renderWithAct(<Header />);

    const buttons = renderer!.root.findAll((node) => typeof node.props?.onClick === 'function');
    await act(async () => {
      buttons.at(-1)!.props.onClick();
    });

    expect(sent.some((msg) => msg.type === 'cancel' && msg.sessionId === 'session-1')).toBe(true);
    expect(sent.some((msg) => msg.type === 'session' && msg.sessionId === 'session-2')).toBe(true);
    expect(useChatStore.getState().sessionId).toBe('session-2');
    renderer!.unmount();
  });

  test('Sidebar switches sessions and cancels streaming', async () => {
    (globalThis as any).crypto = { randomUUID: () => 'session-3' };
    useChatStore.setState({
      isStreaming: true,
      sessionId: 'session-1',
      sessions: [
        { id: 'session-1', label: 'Session 1', createdAt: Date.now() },
        { id: 'session-2', label: 'Session 2', createdAt: Date.now() },
      ],
    });

    const renderer = await renderWithAct(<Sidebar />);

    const buttons = renderer!.root.findAll((node) => typeof node.props?.onClick === 'function');
    await act(async () => {
      buttons[1].props.onClick();
    });

    expect(sent.some((msg) => msg.type === 'cancel')).toBe(true);
    expect(sent.some((msg) => msg.type === 'session' && msg.sessionId === 'session-2')).toBe(true);
    expect(useChatStore.getState().sessionId).toBe('session-2');
    renderer!.unmount();
  });

  test('CommandPalette toggles and triggers new session', async () => {
    const { listeners } = createWindowStub();
    (globalThis as any).crypto = { randomUUID: () => 'session-4' };
    useChatStore.setState({ isStreaming: true, sessionId: 'session-1' });

    const renderer = await renderWithAct(<CommandPalette />);

    expect(renderer!.toJSON()).toBeNull();

    await act(async () => {
      listeners.keydown?.[0]({
        metaKey: true,
        key: 'k',
        preventDefault: () => {},
      });
    });

    const tree = renderer!.toJSON();
    expect(JSON.stringify(tree)).toContain('Commands');

    const buttons = renderer!.root.findAll((node) => typeof node.props?.onClick === 'function');
    await act(async () => {
      buttons[0].props.onClick();
    });

    expect(sent.some((msg) => msg.type === 'cancel' && msg.sessionId === 'session-1')).toBe(true);
    expect(sent.some((msg) => msg.type === 'session' && msg.sessionId === 'session-4')).toBe(true);
    renderer!.unmount();
  });

  test('InputArea sends messages and handles escape cancel', async () => {
    const { listeners } = createWindowStub();
    (globalThis as any).crypto = { randomUUID: () => 'session-5' };

    const renderer = await renderWithAct(<InputArea />);

    const input = renderer!.root.findByType(Input);
    await act(async () => {
      input.props.onChange({ target: { value: 'Hello' } });
    });
    await act(async () => {
      input.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
    });

    expect(useChatStore.getState().messages.length).toBe(2);
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(sent.some((msg) => msg.type === 'message' && msg.content === 'Hello')).toBe(true);

    useChatStore.setState({ isStreaming: true, sessionId: 'session-5' });
    await act(async () => {
      listeners.keydown?.[0]({ key: 'Escape' });
    });

    expect(sent.some((msg) => msg.type === 'cancel' && msg.sessionId === 'session-5')).toBe(true);
    expect(useChatStore.getState().isStreaming).toBe(false);

    renderer!.unmount();
  });

  test('MessageList merges streaming tool calls', async () => {
    useChatStore.setState({
      isStreaming: true,
      currentToolCalls: [{ id: 't2', name: 'read', input: {}, type: 'tool' } as any],
      currentStreamMessageId: 'a1',
    });

    const messages: Message[] = [
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: Date.now(), toolCalls: [{ id: 't1', name: 'bash', input: {}, type: 'tool' } as any] },
    ];

    const renderer = await renderWithAct(<MessageList messages={messages} />);

    const bubble = renderer!.root.findByType(MessageBubble);
    expect(bubble.props.message.toolCalls.length).toBe(2);
    renderer!.unmount();
  });

  test('ChatContainer connects and renders empty state', async () => {
    const { listeners } = createWindowStub();
    (globalThis as any).window.location.protocol = 'https:';
    useChatStore.setState({ sessionId: 'session-9' });

    const renderer = await renderWithAct(<ChatContainer />);

    expect(connected[0]).toBe('wss://example.com/api/ws');
    expect(sent.some((msg) => msg.type === 'session' && msg.sessionId === 'session-9')).toBe(true);

    const tree = renderer!.toJSON();
    expect(JSON.stringify(tree)).toContain('Assistants Web');

    renderer!.unmount();
    // prevent unused warning
    expect(Object.keys(listeners).length).toBeGreaterThanOrEqual(0);
  });

  test('MarkdownRenderer renders markdown content', () => {
    const markup = renderToStaticMarkup(<MarkdownRenderer content="**Bold**" />);
    expect(markup).toContain('<strong>Bold</strong>');
  });

  test('ServiceWorker registers when available', async () => {
    createWindowStub();
    const register = mock(async () => ({}));
    (globalThis as any).navigator = { serviceWorker: { register } };

    const renderer = await renderWithAct(<ServiceWorker />);

    expect(register).toHaveBeenCalledWith('/sw.js');
    renderer!.unmount();
  });
});

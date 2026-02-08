import React from 'react';
import { describe, expect, test, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { useChatStore } from '../src/lib/store';
import { chatWs } from '../src/lib/ws';
import { Textarea } from '../src/components/ui/textarea';
import { MessageBubble } from '../src/components/chat/MessageBubble';
import { MessageList } from '../src/components/chat/MessageList';
import type { ToolCall, ToolResult, Message } from '@hasna/assistants-shared';

// Mock next/navigation for components relying on App Router hooks
mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

mock.module('@/hooks/use-theme', () => ({
  useTheme: () => ({
    theme: 'light',
    resolvedTheme: 'light',
    setTheme: () => {},
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  themeScript: '',
}));

const sent: any[] = [];
const connected: string[] = [];
let disconnects = 0;
const initialWindow = (globalThis as any).window;

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
  (globalThis as any).document = {
    activeElement: null,
    documentElement: {
      classList: {
        add: () => {},
        remove: () => {},
      },
    },
  };
  if (!(globalThis as any).requestAnimationFrame) {
    (globalThis as any).requestAnimationFrame = (cb: () => void) => {
      cb();
      return 0;
    };
  }

  return {
    listeners,
  };
};

const setupAudioStubs = () => {
  let processor: any = null;
  let trackStopCalls = 0;
  const stream = {
    getTracks: () => [{ stop: () => { trackStopCalls += 1; } }],
  };

  class FakeScriptProcessor {
    onaudioprocess: ((event: any) => void) | null = null;
    connect() {}
    disconnect() {}
  }

  class FakeAudioContext {
    sampleRate = 8000;
    state = 'running';
    destination = {};
    createMediaStreamSource() {
      return { connect: () => {} };
    }
    createScriptProcessor() {
      processor = new FakeScriptProcessor();
      return processor;
    }
    createGain() {
      return { gain: { value: 1 }, connect: () => {} };
    }
    async resume() {
      this.state = 'running';
    }
    async close() {}
  }

  (globalThis as any).AudioContext = FakeAudioContext;
  (globalThis as any).navigator = {
    language: 'en-US',
    mediaDevices: {
      getUserMedia: async () => stream,
    },
  };

  return {
    getProcessor: () => processor,
    getStopCalls: () => trackStopCalls,
  };
};

describe('web extra components', () => {
  let originalWindow: any;
  let originalNavigator: any;
  let originalCrypto: any;
  let originalChatWs: { send: any; connect: any; disconnect: any } | null = null;
  let originalFetch: any;
  let originalDocument: any;
  let originalRequestAnimationFrame: any;

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
      isListening: false,
      listeningDraft: '',
    });

    originalWindow = (globalThis as any).window;
    originalNavigator = (globalThis as any).navigator;
    originalCrypto = (globalThis as any).crypto;
    originalFetch = (globalThis as any).fetch;
    originalDocument = (globalThis as any).document;
    originalRequestAnimationFrame = (globalThis as any).requestAnimationFrame;
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      (globalThis as any).window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        location: { protocol: 'http:', host: 'example.com' },
      };
    } else {
      (globalThis as any).window = originalWindow;
    }
    (globalThis as any).navigator = originalNavigator;
    (globalThis as any).crypto = originalCrypto;
    if (originalDocument === undefined) {
      delete (globalThis as any).document;
    } else {
      (globalThis as any).document = originalDocument;
    }
    if (originalRequestAnimationFrame === undefined) {
      delete (globalThis as any).requestAnimationFrame;
    } else {
      (globalThis as any).requestAnimationFrame = originalRequestAnimationFrame;
    }
    if (originalChatWs) {
      chatWs.send = originalChatWs.send;
      chatWs.connect = originalChatWs.connect;
      chatWs.disconnect = originalChatWs.disconnect;
    }
    if (originalFetch === undefined) {
      delete (globalThis as any).fetch;
    } else {
      (globalThis as any).fetch = originalFetch;
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
    expect(JSON.stringify(tree)).toContain('Search commands');

    const optionButtons = renderer!.root.findAll((node) => node.props?.role === 'option');
    const textContent = (node: any): string => {
      if (!node) return '';
      if (typeof node === 'string') return node;
      if (Array.isArray(node.children)) {
        return node.children.map(textContent).join('');
      }
      return '';
    };
    const newSessionButton = optionButtons.find((node) => textContent(node).includes('New chat session'));
    await act(async () => {
      newSessionButton?.props.onClick();
    });

    expect(sent.some((msg) => msg.type === 'cancel' && msg.sessionId === 'session-1')).toBe(true);
    expect(sent.some((msg) => msg.type === 'session' && msg.sessionId === 'session-4')).toBe(true);
    renderer!.unmount();
  });

  test('InputArea sends messages and handles escape cancel', async () => {
    const { listeners } = createWindowStub();
    (globalThis as any).crypto = { randomUUID: () => 'session-5' };

    const renderer = await renderWithAct(<InputArea />);

    const input = renderer!.root.findByType(Textarea);
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

  test('InputArea runs ! shell commands and sends output', async () => {
    createWindowStub();
    (globalThis as any).crypto = { randomUUID: () => 'session-7' };

    const fetchMock = mock(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          ok: true,
          stdout: 'hi',
          stderr: '',
          exitCode: 0,
          truncated: false,
        },
      }),
    }));
    (globalThis as any).fetch = fetchMock;

    const renderer = await renderWithAct(<InputArea />);
    const input = renderer!.root.findByType(Textarea);

    await act(async () => {
      input.props.onChange({ target: { value: '!echo hi' } });
    });
    await act(async () => {
      await input.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.command).toBe('echo hi');
    expect(sent.some((msg) => msg.type === 'message' && msg.content.includes('Local shell command executed'))).toBe(true);

    renderer!.unmount();
  });

  test('InputArea toggles /listen without sending a message', async () => {
    const { listeners } = createWindowStub();
    (globalThis as any).crypto = { randomUUID: () => 'session-6' };
    const audioStubs = setupAudioStubs();

    const renderer = await renderWithAct(<InputArea />);

    const input = renderer!.root.findByType(Textarea);
    await act(async () => {
      input.props.onChange({ target: { value: '/listen' } });
    });
    await act(async () => {
      input.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
    });

    expect(sent.some((msg) => msg.type === 'message' && msg.content === '/listen')).toBe(false);

    let tree = renderer!.toJSON();
    expect(JSON.stringify(tree)).toContain('listening...');

    await act(async () => {
      listeners.keydown?.[0]({ key: 'Escape' });
    });

    expect(audioStubs.getStopCalls()).toBeGreaterThan(0);
    tree = renderer!.toJSON();
    expect(JSON.stringify(tree)).not.toContain('listening...');

    renderer!.unmount();
  });

  test('InputArea stops listening on /listen stop', async () => {
    createWindowStub();
    (globalThis as any).crypto = { randomUUID: () => 'session-9' };
    const audioStubs = setupAudioStubs();

    const renderer = await renderWithAct(<InputArea />);
    const input = renderer!.root.findByType(Textarea);

    await act(async () => {
      input.props.onChange({ target: { value: '/listen' } });
    });
    await act(async () => {
      input.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
    });

    await act(async () => {
      input.props.onChange({ target: { value: '/listen stop' } });
    });
    await act(async () => {
      input.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
    });

    expect(audioStubs.getStopCalls()).toBeGreaterThan(0);
    expect(sent.some((msg) => msg.type === 'message' && msg.content.includes('/listen stop'))).toBe(false);

    renderer!.unmount();
  });

  test('InputArea ignores manual typing while listening', async () => {
    createWindowStub();
    (globalThis as any).crypto = { randomUUID: () => 'session-10' };
    setupAudioStubs();

    const renderer = await renderWithAct(<InputArea />);
    const input = renderer!.root.findByType(Textarea);

    await act(async () => {
      input.props.onChange({ target: { value: '/listen' } });
    });
    await act(async () => {
      input.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
    });

    await act(async () => {
      input.props.onChange({ target: { value: 'manual typing' } });
    });

    const updated = renderer!.root.findByType(Textarea);
    expect(updated.props.value).toBe('');

    renderer!.unmount();
  });

  test('InputArea sends shell command output on ! prefix', async () => {
    createWindowStub();
    (globalThis as any).crypto = { randomUUID: () => 'session-7' };
    useChatStore.setState({ sessionId: 'session-7' });

    (globalThis as any).fetch = async (_input: any, init?: any) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      if (body.command !== 'pwd') {
        return new Response(JSON.stringify({ success: false, error: { message: 'Unexpected command' } }), { status: 400 });
      }
      return new Response(JSON.stringify({
        success: true,
        data: {
          ok: true,
          stdout: '/tmp/project',
          stderr: '',
          exitCode: 0,
          truncated: false,
        },
      }), { status: 200 });
    };

    const renderer = await renderWithAct(<InputArea />);

    const input = renderer!.root.findByType(Textarea);
    await act(async () => {
      input.props.onChange({ target: { value: '!pwd' } });
    });
    await act(async () => {
      input.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
    });

    expect(sent.some((msg) => msg.type === 'message' && msg.content.includes('Local shell command executed'))).toBe(true);
    expect(sent.some((msg) => msg.type === 'message' && msg.content.includes('$ pwd'))).toBe(true);

    renderer!.unmount();
  });

  test('InputArea sends shell command error output on ! prefix failure', async () => {
    createWindowStub();
    (globalThis as any).crypto = { randomUUID: () => 'session-12' };
    useChatStore.setState({ sessionId: 'session-12' });

    (globalThis as any).fetch = async () => {
      return new Response(JSON.stringify({ success: false, error: { message: 'Not allowed' } }), { status: 400 });
    };

    const renderer = await renderWithAct(<InputArea />);

    const input = renderer!.root.findByType(Textarea);
    await act(async () => {
      input.props.onChange({ target: { value: '!whoami' } });
    });
    await act(async () => {
      input.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
    });

    expect(sent.some((msg) => msg.type === 'message' && msg.content.includes('Local shell command executed'))).toBe(true);
    expect(sent.some((msg) => msg.type === 'message' && msg.content.includes('Not allowed'))).toBe(true);

    renderer!.unmount();
  });

  test('InputArea sends dictation after silence threshold', async () => {
    createWindowStub();
    (globalThis as any).crypto = { randomUUID: () => 'session-8' };
    const audioStubs = setupAudioStubs();

    const originalNow = Date.now;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervalCallbacks: Array<() => void> = [];
    let nowValue = 0;
    Date.now = () => nowValue;
    globalThis.setInterval = ((cb: () => void) => {
      intervalCallbacks.push(cb);
      return 1 as any;
    }) as any;
    globalThis.clearInterval = (() => {}) as any;

    let renderer: ReturnType<typeof create> | null = null;
    try {
      (globalThis as any).fetch = async () => {
        return new Response(JSON.stringify({
          success: true,
          data: { text: 'hello', confidence: 1, language: 'en' },
        }), { status: 200 });
      };

      renderer = await renderWithAct(<InputArea />);
      const input = renderer!.root.findByType(Textarea);
      await act(async () => {
        input.props.onChange({ target: { value: '/listen' } });
      });
      await act(async () => {
        input.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => {} });
      });

      const processor = audioStubs.getProcessor();
      const sample = new Float32Array(4096).fill(0.2);
      nowValue = 1000;
      processor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => sample } });

      nowValue = 5000;
      intervalCallbacks.forEach((cb) => cb());

      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(sent.some((msg) => msg.type === 'message' && msg.content === 'hello')).toBe(true);
    } finally {
      renderer?.unmount();
      Date.now = originalNow;
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test('MessageList shows live dictation draft when listening', async () => {
    const renderer = await renderWithAct(<MessageList messages={[]} />);
    await act(async () => {
      useChatStore.setState({ isListening: true, listeningDraft: 'dictating now' });
    });
    const tree = renderer!.toJSON();
    expect(JSON.stringify(tree)).toContain('dictating now');
    expect(JSON.stringify(tree)).toContain('Live dictation');
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

    expect(connected[0]).toBe('wss://example.com/api/v1/ws');
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

afterAll(() => {
  if (initialWindow === undefined) {
    delete (globalThis as any).window;
  } else {
    (globalThis as any).window = initialWindow;
  }
  mock.restore();
});

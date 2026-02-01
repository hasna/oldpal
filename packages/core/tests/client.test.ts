import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Message, Tool, Skill, StreamChunk } from '@hasna/assistants-shared';
import type { Command } from '../src/commands';
import { EmbeddedClient } from '../src/client';

class MockContext {
  private messages: Message[] = [];

  import(messages: Message[]) {
    this.messages = [...messages];
  }

  addUserMessage(content: string) {
    this.messages.push({
      id: `u-${this.messages.length + 1}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  addAssistantMessage(content: string) {
    this.messages.push({
      id: `a-${this.messages.length + 1}`,
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  clear() {
    this.messages = [];
  }
}

let lastOptions: any;

class MockAgentLoop {
  private context = new MockContext();
  private processing = false;

  constructor(options: any) {
    lastOptions = options;
  }

  async initialize() {}

  async process(message: string) {
    if (message === 'fail') {
      throw new Error('boom');
    }
    this.processing = true;
    this.context.addUserMessage(message);
    this.context.addAssistantMessage('ok');
    const toolCall = { id: 't1', name: 'bash', input: { command: 'ls' } };
    lastOptions?.onToolStart?.(toolCall);
    lastOptions?.onToolEnd?.(toolCall, { toolCallId: 't1', content: 'ok', isError: false });
    lastOptions?.onChunk?.({ type: 'text', content: 'ok' } as StreamChunk);
    this.processing = false;
  }

  getContext() {
    return this.context;
  }

  getTools(): Tool[] {
    return [{ name: 'tool', description: 't', parameters: { type: 'object', properties: {} } }];
  }

  getSkills(): Skill[] {
    return [{ name: 'skill', description: 's' }];
  }

  getCommands(): Command[] {
    return [{ name: 'cmd', description: 'c', content: '', builtin: true }];
  }

  getTokenUsage() {
    return { inputTokens: 1, outputTokens: 2, totalTokens: 3, maxContextTokens: 10 };
  }

  stop() {
    this.processing = false;
  }

  isProcessing() {
    return this.processing;
  }

  clearConversation() {
    this.context.clear();
  }
}

let tempDir: string;
let originalAssistantsDir: string | undefined;
let originalOldpalDir: string | undefined;

beforeEach(() => {
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  originalOldpalDir = process.env.OLDPAL_DIR;
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-client-'));
  process.env.ASSISTANTS_DIR = tempDir;
});

afterEach(() => {
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
  process.env.OLDPAL_DIR = originalOldpalDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('EmbeddedClient', () => {
  test('uses default agent factory when none provided', () => {
    const client = new EmbeddedClient(tempDir, { sessionId: 'sess-default' });
    expect(client.getSessionId()).toBe('sess-default');
  });

  test('initializes with initial messages', async () => {
    const initialMessages: Message[] = [
      { id: '1', role: 'user', content: 'hi', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'hello', timestamp: 2 },
    ];

    const client = new EmbeddedClient(tempDir, {
      initialMessages,
      sessionId: 'sess',
      agentFactory: (options) => new MockAgentLoop(options) as any,
    });
    await client.initialize();

    const messages = client.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('hi');
  });

  test('send updates messages and emits chunks', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      agentFactory: (options) => new MockAgentLoop(options) as any,
    });
    const chunks: StreamChunk[] = [];
    client.onChunk((chunk) => chunks.push(chunk));

    await client.send('ping');

    expect(chunks.length).toBeGreaterThan(0);
    const messages = client.getMessages();
    expect(messages.at(-1)?.role).toBe('assistant');
    expect(messages.at(-1)?.content).toBe('ok');
  });

  test('clearConversation resets messages', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      agentFactory: (options) => new MockAgentLoop(options) as any,
    });
    await client.send('hello');
    expect(client.getMessages().length).toBeGreaterThan(0);
    client.clearConversation();
    expect(client.getMessages()).toHaveLength(0);
  });

  test('proxies tools, skills, and commands', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      agentFactory: (options) => new MockAgentLoop(options) as any,
    });
    expect((await client.getTools())[0].name).toBe('tool');
    expect((await client.getSkills())[0].name).toBe('skill');
    expect((await client.getCommands())[0].name).toBe('cmd');
  });

  test('stop, disconnect, and token usage work', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      agentFactory: (options) => new MockAgentLoop(options) as any,
    });
    await client.send('hello');
    expect(client.getTokenUsage().totalTokens).toBe(3);

    client.stop();
    expect(client.isProcessing()).toBe(false);

    client.disconnect();
    expect(client.getSessionId()).toBe('sess');
    expect(client.getCwd()).toBe(tempDir);
    expect(typeof client.getStartedAt()).toBe('string');
  });

  test('propagates errors to callbacks', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      agentFactory: (options) => new MockAgentLoop(options) as any,
    });
    const errors: Error[] = [];
    client.onError((err) => errors.push(err));

    await client.send('fail');

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('boom');
  });
});

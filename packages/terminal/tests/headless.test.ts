import { describe, expect, test, beforeEach, mock } from 'bun:test';

let mockChunks: any[] = [];
let latestMessage: string | null = null;
let stopped = false;
let disconnected = false;

mock.module('@hasna/assistants-core', () => ({
  EmbeddedClient: class EmbeddedClient {
    private sessionId: string;
    private chunkHandlers: Array<(chunk: any) => void> = [];
    private errorHandlers: Array<(err: Error) => void> = [];

    constructor(_cwd: string, options: { sessionId?: string }) {
      this.sessionId = options.sessionId ?? 'session-1';
    }

    async initialize() {
      return;
    }

    onChunk(cb: (chunk: any) => void) {
      this.chunkHandlers.push(cb);
    }

    onError(cb: (err: Error) => void) {
      this.errorHandlers.push(cb);
    }

    async send(message: string) {
      latestMessage = message;
      for (const chunk of mockChunks) {
        for (const handler of this.chunkHandlers) {
          handler(chunk);
        }
      }
    }

    getSessionId() {
      return this.sessionId;
    }

    getTokenUsage() {
      return { inputTokens: 1, outputTokens: 2, totalTokens: 3, maxContextTokens: 100 };
    }

    stop() {
      stopped = true;
    }

    disconnect() {
      disconnected = true;
    }
  },
  SessionStorage: {
    loadSession: (id: string) => (id === 'exists' ? { cwd: '/tmp', messages: [], startedAt: 0 } : null),
    getLatestSession: () => ({ id: 'exists' }),
  },
}));

const { runHeadless } = await import('../src/headless');

describe('runHeadless', () => {
  beforeEach(() => {
    mockChunks = [];
    latestMessage = null;
    stopped = false;
    disconnected = false;
  });

  test('outputs JSON with tool calls and structured output', async () => {
    const originalLog = console.log;
    let captured = '';
    console.log = (msg?: any) => {
      captured = String(msg ?? '');
    };

    mockChunks = [
      { type: 'text', content: '{"ok":true}' },
      { type: 'tool_use', toolCall: { id: 't1', name: 'bash', input: { command: 'ls' } } },
      { type: 'done' },
    ];

    await runHeadless({
      prompt: 'Test',
      cwd: '/tmp',
      outputFormat: 'json',
      jsonSchema: '{"type":"object"}',
    });

    const parsed = JSON.parse(captured);
    expect(parsed.result).toBe('{"ok":true}');
    expect(parsed.tool_calls.length).toBe(1);
    expect(parsed.structured_output.ok).toBe(true);
    expect(latestMessage).toContain('IMPORTANT:');
    expect(disconnected).toBe(true);

    console.log = originalLog;
  });

  test('stream-json outputs events and exits on error', async () => {
    const originalWrite = process.stdout.write;
    const originalExit = process.exit;
    let stdout = '';
    let exitCode: number | null = null;
    (process.stdout as any).write = (chunk: any) => {
      stdout += String(chunk);
    };
    (process as any).exit = (code: number) => {
      exitCode = code;
    };

    mockChunks = [
      { type: 'text', content: 'hello' },
      { type: 'tool_result', toolResult: { toolCallId: 't1', content: 'boom', isError: true } },
      { type: 'done' },
    ];

    await runHeadless({
      prompt: 'Test',
      cwd: '/tmp',
      outputFormat: 'stream-json',
    });

    expect(stdout).toContain('text_delta');
    expect(stdout).toContain('tool_result');
    expect(exitCode).toBe(1);

    process.stdout.write = originalWrite;
    process.exit = originalExit;
  });

  test('throws for missing resume session', async () => {
    await expect(runHeadless({
      prompt: 'Test',
      cwd: '/tmp',
      outputFormat: 'text',
      resume: 'missing',
    })).rejects.toThrow('Session missing not found');
  });
});

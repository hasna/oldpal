import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { StreamChunk } from '@hasna/assistants-shared';
import { AssistantLoop } from '../src/agent/loop';
import { nativeHookRegistry } from '../src/hooks/native';
import { ContextManager } from '../src/context/manager';
import type { SummaryStrategy } from '../src/context/summarizer';

let callCount = 0;

describe('AssistantLoop process', () => {
  beforeEach(() => {
    nativeHookRegistry.clear();
  });

  beforeEach(() => {
    callCount = 0;
  });

  test('auto compaction summarizes when context grows too large', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-sum-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    class StubSummarizer implements SummaryStrategy {
      name = 'stub';
      async summarize(): Promise<string> {
        return 'stub summary';
      }
    }

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    const contextConfig = {
      enabled: true,
      maxContextTokens: 50,
      targetContextTokens: 40,
      summaryTriggerRatio: 0.5,
      keepRecentMessages: 0,
      keepSystemPrompt: false,
      summaryStrategy: 'llm',
      summaryMaxTokens: 50,
      maxMessages: 100,
    };

    (assistant as any).contextConfig = contextConfig;
    (assistant as any).contextManager = new ContextManager(contextConfig, new StubSummarizer());

    await assistant.process('word '.repeat(200));

    const messages = assistant.getContext().getMessages();
    expect(messages.some((msg) => msg.role === 'system' && msg.content.includes('Context Summary'))).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'text' && chunk.content?.includes('Context summarized'))).toBe(true);
  });

  test('executes tool calls and continues the loop', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-loop-'));
    const assistant = new AssistantLoop({ cwd });

    // Inject a fake LLM client and minimal config to avoid network calls
    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        callCount += 1;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: { id: 'tc1', name: 'test_tool', input: { foo: 'bar' } },
          };
          yield { type: 'done' };
          return;
        }
        yield { type: 'text', content: 'final' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).toolRegistry.register(
      { name: 'test_tool', description: 't', parameters: { type: 'object', properties: {} } },
      async (input: Record<string, unknown>) => JSON.stringify(input)
    );

    await assistant.process('hi');

    const messages = assistant.getContext().getMessages();
    const last = messages[messages.length - 1];
    expect(last?.role).toBe('assistant');
    expect(last?.content).toContain('final');

    const toolResultMessage = messages.find((m) => m.toolResults?.length);
    expect(toolResultMessage?.toolResults?.[0].content).toContain('"foo":"bar"');
    expect(callCount).toBe(2);
  });

  test('handles built-in commands without calling the LLM', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-cmd-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    let chatCalls = 0;
    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'should-not-run' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (assistant as any).builtinCommands.registerAll((assistant as any).commandLoader);

    await assistant.process('/help');

    expect(chatCalls).toBe(0);
    expect(chunks.some((c) => c.type === 'text' && c.content?.includes('Available Slash Commands'))).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  test('executes explicit bash tool command without LLM', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-bash-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    let chatCalls = 0;
    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'should-not-run' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).toolRegistry.register(
      { name: 'bash', description: 'Run commands', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );

    await assistant.process('![bash] echo hi');

    expect(chatCalls).toBe(0);
    expect(chunks.some((c) => c.type === 'tool_use')).toBe(true);
    expect(chunks.some((c) => c.type === 'tool_result')).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  test('explicit bash tool command returns error when tool fails', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-bash-error-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    let chatCalls = 0;
    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'should-not-run' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).toolRegistry.register(
      { name: 'bash', description: 'Run commands', parameters: { type: 'object', properties: {} } },
      async () => 'Error: blocked'
    );

    const result = await (assistant as any).runMessage('![bash] rm -rf /', 'user');

    expect(chatCalls).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Error: blocked');
    }
    expect(chunks.some((c) => c.type === 'tool_use')).toBe(true);
    expect(chunks.some((c) => c.type === 'tool_result')).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  test('stop halts streaming after first chunk', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-stop-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => {
        chunks.push(chunk);
        if (chunk.type === 'text') {
          assistant.stop();
        }
      },
    });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'first' };
        yield { type: 'text', content: 'second' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    await assistant.process('hello');

    const last = assistant.getContext().getMessages().slice(-1)[0];
    expect(last?.content).toContain('first');
    expect(last?.content).not.toContain('second');
    expect(chunks.filter((c) => c.type === 'text').length).toBe(1);
  });

  test('stop skips scope verification rerun', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-stop-scope-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => {
        chunks.push(chunk);
        if (chunk.type === 'text') {
          assistant.stop();
        }
      },
    });

    let chatCalls = 0;
    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'first' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    nativeHookRegistry.register({
      id: 'scope-verification',
      event: 'Stop',
      priority: 1,
      handler: async () => ({ continue: false, systemMessage: 'retry' }),
    });

    await assistant.process('fix this bug in the system');

    expect(chatCalls).toBe(2);
  });

  test('stop prevents tool execution after tool_use', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-stop-tools-'));
    let toolStartCalled = false;
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => {
        if (chunk.type === 'tool_use') {
          assistant.stop();
        }
      },
      onToolStart: () => {
        toolStartCalled = true;
      },
    });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'tool_use', toolCall: { id: 'tc1', name: 'test_tool', input: { ok: true } } };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).toolRegistry.register(
      { name: 'test_tool', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'should-not-run'
    );

    await assistant.process('hi');

    expect(toolStartCalled).toBe(false);
    const hasToolResults = assistant.getContext().getMessages().some((m) => m.toolResults?.length);
    expect(hasToolResults).toBe(false);
  });

  test('clear command resets context via command handler', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-clear-'));
    const assistant = new AssistantLoop({ cwd });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (assistant as any).builtinCommands.registerAll((assistant as any).commandLoader);

    assistant.getContext().addUserMessage('hello');
    expect(assistant.getContext().getMessages().length).toBe(1);

    await assistant.process('/clear');

    expect(assistant.getContext().getMessages().length).toBe(0);
  });

  test('applies command allowed tools when executing prompt', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-cmdtools-'));
    const assistant = new AssistantLoop({ cwd });
    let receivedTools: Array<{ name: string }> | undefined;

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (
        messages: unknown[],
        tools?: Array<{ name: string }>
      ): AsyncGenerator<StreamChunk> {
        receivedTools = tools;
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (assistant as any).builtinCommands.registerAll((assistant as any).commandLoader);

    (assistant as any).toolRegistry.register(
      { name: 'bash', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );
    (assistant as any).toolRegistry.register(
      { name: 'read', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );

    (assistant as any).commandLoader.register({
      name: 'run',
      description: 'Run command',
      content: 'Do $ARGUMENTS',
      allowedTools: ['bash'],
    });

    await assistant.process('/run something');

    expect(receivedTools?.map((t) => t.name).sort()).toEqual(['bash']);
  });

  test('handles skill invocation and filters tools', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-skill-'));
    const assistant = new AssistantLoop({ cwd });
    let receivedTools: Array<{ name: string }> | undefined;
    let receivedSystemPrompt: string | undefined;

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (
        messages: unknown[],
        tools?: Array<{ name: string }>,
        systemPrompt?: string
      ): AsyncGenerator<StreamChunk> {
        receivedTools = tools;
        receivedSystemPrompt = systemPrompt;
        yield { type: 'text', content: 'done' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).toolRegistry.register(
      { name: 'read', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );
    (assistant as any).toolRegistry.register(
      { name: 'bash', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );

    (assistant as any).skillLoader.skills.set('demo', {
      name: 'demo',
      description: 'Demo skill',
      content: 'Skill content',
      allowedTools: ['read'],
      filePath: join(cwd, 'SKILL.md'),
      contentLoaded: true,
    });

    await assistant.process('/demo arg1 arg2');

    expect(receivedTools?.map((t) => t.name).sort()).toEqual(['read']);
    expect(receivedSystemPrompt).toContain('Skill content');
  });

  test('handles /skills and /connectors commands with context data', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-ctx-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (assistant as any).builtinCommands.registerAll((assistant as any).commandLoader);

    (assistant as any).skillLoader.skills.set('alpha', {
      name: 'alpha',
      description: 'Alpha skill',
      content: 'Skill',
      filePath: join(cwd, 'SKILL.md'),
    });

    (assistant as any).connectorBridge.connectors.set('demo', {
      name: 'demo',
      cli: 'connect-demo',
      description: 'Demo connector',
      commands: [{ name: 'list', description: 'List', args: [], options: [] }],
    });

    await assistant.process('/skills');
    await assistant.process('/connectors --list');

    const textChunks = chunks.filter((c) => c.type === 'text' && c.content);
    expect(textChunks.some((c) => c.content?.includes('alpha'))).toBe(true);
    expect(textChunks.some((c) => c.content?.includes('demo'))).toBe(true);
  });

  test('command context can add system messages', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-sysmsg-'));
    const assistant = new AssistantLoop({ cwd });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).commandLoader.register({
      name: 'sysmsg',
      description: 'Add system message',
      content: '',
      selfHandled: true,
      handler: async (_args, context) => {
        context.addSystemMessage('system-note');
        context.emit('done');
        return { handled: true };
      },
    });

    await assistant.process('/sysmsg');

    const messages = assistant.getContext().getMessages();
    expect(messages.some((m) => m.role === 'system' && m.content === 'system-note')).toBe(true);
  });
});

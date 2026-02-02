import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { StreamChunk } from '@hasna/assistants-shared';
import { AgentLoop } from '../src/agent/loop';
import { nativeHookRegistry } from '../src/hooks/native';
import { ContextManager } from '../src/context/manager';
import type { SummaryStrategy } from '../src/context/summarizer';

let callCount = 0;

describe('AgentLoop process', () => {
  beforeEach(() => {
    nativeHookRegistry.clear();
  });

  beforeEach(() => {
    callCount = 0;
  });

  test('auto compaction summarizes when context grows too large', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-sum-'));
    const chunks: StreamChunk[] = [];
    const agent = new AgentLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    class StubSummarizer implements SummaryStrategy {
      name = 'stub';
      async summarize(): Promise<string> {
        return 'stub summary';
      }
    }

    (agent as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
    };
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

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

    (agent as any).contextConfig = contextConfig;
    (agent as any).contextManager = new ContextManager(contextConfig, new StubSummarizer());

    await agent.process('word '.repeat(200));

    const messages = agent.getContext().getMessages();
    expect(messages.some((msg) => msg.role === 'system' && msg.content.includes('Context Summary'))).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'text' && chunk.content?.includes('Context summarized'))).toBe(true);
  });

  test('executes tool calls and continues the loop', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-'));
    const agent = new AgentLoop({ cwd });

    // Inject a fake LLM client and minimal config to avoid network calls
    (agent as any).llmClient = {
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
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (agent as any).toolRegistry.register(
      { name: 'test_tool', description: 't', parameters: { type: 'object', properties: {} } },
      async (input: Record<string, unknown>) => JSON.stringify(input)
    );

    await agent.process('hi');

    const messages = agent.getContext().getMessages();
    const last = messages[messages.length - 1];
    expect(last?.role).toBe('assistant');
    expect(last?.content).toContain('final');

    const toolResultMessage = messages.find((m) => m.toolResults?.length);
    expect(toolResultMessage?.toolResults?.[0].content).toContain('"foo":"bar"');
    expect(callCount).toBe(2);
  });

  test('handles built-in commands without calling the LLM', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-cmd-'));
    const chunks: StreamChunk[] = [];
    const agent = new AgentLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    let chatCalls = 0;
    (agent as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'should-not-run' };
        yield { type: 'done' };
      },
    };
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (agent as any).builtinCommands.registerAll((agent as any).commandLoader);

    await agent.process('/help');

    expect(chatCalls).toBe(0);
    expect(chunks.some((c) => c.type === 'text' && c.content?.includes('Available Slash Commands'))).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  test('executes explicit bash tool command without LLM', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-bash-'));
    const chunks: StreamChunk[] = [];
    const agent = new AgentLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    let chatCalls = 0;
    (agent as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'should-not-run' };
        yield { type: 'done' };
      },
    };
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (agent as any).toolRegistry.register(
      { name: 'bash', description: 'Run commands', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );

    await agent.process('![bash] echo hi');

    expect(chatCalls).toBe(0);
    expect(chunks.some((c) => c.type === 'tool_use')).toBe(true);
    expect(chunks.some((c) => c.type === 'tool_result')).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  test('explicit bash tool command returns error when tool fails', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-bash-error-'));
    const chunks: StreamChunk[] = [];
    const agent = new AgentLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    let chatCalls = 0;
    (agent as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'should-not-run' };
        yield { type: 'done' };
      },
    };
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (agent as any).toolRegistry.register(
      { name: 'bash', description: 'Run commands', parameters: { type: 'object', properties: {} } },
      async () => 'Error: blocked'
    );

    const result = await (agent as any).runMessage('![bash] rm -rf /', 'user');

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
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-stop-'));
    const chunks: StreamChunk[] = [];
    const agent = new AgentLoop({
      cwd,
      onChunk: (chunk) => {
        chunks.push(chunk);
        if (chunk.type === 'text') {
          agent.stop();
        }
      },
    });

    (agent as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'first' };
        yield { type: 'text', content: 'second' };
        yield { type: 'done' };
      },
    };
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    await agent.process('hello');

    const last = agent.getContext().getMessages().slice(-1)[0];
    expect(last?.content).toContain('first');
    expect(last?.content).not.toContain('second');
    expect(chunks.filter((c) => c.type === 'text').length).toBe(1);
  });

  test('stop skips scope verification rerun', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-stop-scope-'));
    const chunks: StreamChunk[] = [];
    const agent = new AgentLoop({
      cwd,
      onChunk: (chunk) => {
        chunks.push(chunk);
        if (chunk.type === 'text') {
          agent.stop();
        }
      },
    });

    let chatCalls = 0;
    (agent as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'first' };
        yield { type: 'done' };
      },
    };
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    nativeHookRegistry.register({
      id: 'scope-verification',
      event: 'Stop',
      priority: 1,
      handler: async () => ({ continue: false, systemMessage: 'retry' }),
    });

    await agent.process('fix this bug in the system');

    expect(chatCalls).toBe(2);
  });

  test('stop prevents tool execution after tool_use', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-stop-tools-'));
    let toolStartCalled = false;
    const agent = new AgentLoop({
      cwd,
      onChunk: (chunk) => {
        if (chunk.type === 'tool_use') {
          agent.stop();
        }
      },
      onToolStart: () => {
        toolStartCalled = true;
      },
    });

    (agent as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'tool_use', toolCall: { id: 'tc1', name: 'test_tool', input: { ok: true } } };
        yield { type: 'done' };
      },
    };
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (agent as any).toolRegistry.register(
      { name: 'test_tool', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'should-not-run'
    );

    await agent.process('hi');

    expect(toolStartCalled).toBe(false);
    const hasToolResults = agent.getContext().getMessages().some((m) => m.toolResults?.length);
    expect(hasToolResults).toBe(false);
  });

  test('clear command resets context via command handler', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-clear-'));
    const agent = new AgentLoop({ cwd });

    (agent as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'done' };
      },
    };
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (agent as any).builtinCommands.registerAll((agent as any).commandLoader);

    agent.getContext().addUserMessage('hello');
    expect(agent.getContext().getMessages().length).toBe(1);

    await agent.process('/clear');

    expect(agent.getContext().getMessages().length).toBe(0);
  });

  test('applies command allowed tools when executing prompt', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-cmdtools-'));
    const agent = new AgentLoop({ cwd });
    let receivedTools: Array<{ name: string }> | undefined;

    (agent as any).llmClient = {
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
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (agent as any).builtinCommands.registerAll((agent as any).commandLoader);

    (agent as any).toolRegistry.register(
      { name: 'bash', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );
    (agent as any).toolRegistry.register(
      { name: 'read', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );

    (agent as any).commandLoader.register({
      name: 'run',
      description: 'Run command',
      content: 'Do $ARGUMENTS',
      allowedTools: ['bash'],
    });

    await agent.process('/run something');

    expect(receivedTools?.map((t) => t.name).sort()).toEqual(['bash']);
  });

  test('handles skill invocation and filters tools', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-skill-'));
    const agent = new AgentLoop({ cwd });
    let receivedTools: Array<{ name: string }> | undefined;
    let receivedSystemPrompt: string | undefined;

    (agent as any).llmClient = {
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
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (agent as any).toolRegistry.register(
      { name: 'read', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );
    (agent as any).toolRegistry.register(
      { name: 'bash', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );

    (agent as any).skillLoader.skills.set('demo', {
      name: 'demo',
      description: 'Demo skill',
      content: 'Skill content',
      allowedTools: ['read'],
      filePath: join(cwd, 'SKILL.md'),
      contentLoaded: true,
    });

    await agent.process('/demo arg1 arg2');

    expect(receivedTools?.map((t) => t.name).sort()).toEqual(['read']);
    expect(receivedSystemPrompt).toContain('Skill content');
  });

  test('handles /skills and /connectors commands with context data', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-ctx-'));
    const chunks: StreamChunk[] = [];
    const agent = new AgentLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    (agent as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'done' };
      },
    };
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (agent as any).builtinCommands.registerAll((agent as any).commandLoader);

    (agent as any).skillLoader.skills.set('alpha', {
      name: 'alpha',
      description: 'Alpha skill',
      content: 'Skill',
      filePath: join(cwd, 'SKILL.md'),
    });

    (agent as any).connectorBridge.connectors.set('demo', {
      name: 'demo',
      cli: 'connect-demo',
      description: 'Demo connector',
      commands: [{ name: 'list', description: 'List', args: [], options: [] }],
    });

    await agent.process('/skills');
    await agent.process('/connectors');

    const textChunks = chunks.filter((c) => c.type === 'text' && c.content);
    expect(textChunks.some((c) => c.content?.includes('alpha'))).toBe(true);
    expect(textChunks.some((c) => c.content?.includes('demo'))).toBe(true);
  });

  test('command context can add system messages', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-agent-sysmsg-'));
    const agent = new AgentLoop({ cwd });

    (agent as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'done' };
      },
    };
    (agent as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (agent as any).commandLoader.register({
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

    await agent.process('/sysmsg');

    const messages = agent.getContext().getMessages();
    expect(messages.some((m) => m.role === 'system' && m.content === 'system-note')).toBe(true);
  });
});

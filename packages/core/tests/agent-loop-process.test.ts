import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { StreamChunk } from '@oldpal/shared';
import { AgentLoop } from '../src/agent/loop';

let callCount = 0;

describe('AgentLoop process', () => {
  beforeEach(() => {
    callCount = 0;
  });

  test('executes tool calls and continues the loop', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oldpal-agent-'));
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
});

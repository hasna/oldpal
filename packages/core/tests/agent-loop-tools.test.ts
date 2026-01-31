import { describe, expect, test } from 'bun:test';
import { AgentLoop } from '../src/agent/loop';
import type { Tool } from '@oldpal/shared';

const makeTool = (name: string): Tool => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
});

describe('AgentLoop allowed tools', () => {
  test('should intersect global and command allowed tools', () => {
    const agent = new AgentLoop({ allowedTools: ['Read', 'Bash'] });
    const current = (agent as any).normalizeAllowedTools(['Edit', 'Bash']);
    (agent as any).currentAllowedTools = current;

    const tools = [makeTool('read'), makeTool('write'), makeTool('bash')];
    const filtered = (agent as any).filterAllowedTools(tools) as Tool[];

    expect(filtered.map((t) => t.name)).toEqual(['bash']);
    expect((agent as any).isToolAllowed('bash')).toBe(true);
    expect((agent as any).isToolAllowed('read')).toBe(false);
  });

  test('should allow all tools when no restrictions are set', () => {
    const agent = new AgentLoop();
    const tools = [makeTool('read'), makeTool('write')];
    const filtered = (agent as any).filterAllowedTools(tools) as Tool[];
    expect(filtered).toEqual(tools);
  });
});

describe('AgentLoop system prompt composition', () => {
  test('should compose base, extra, and system messages without duplication', () => {
    const agent = new AgentLoop({ extraSystemPrompt: 'Extra' });
    (agent as any).systemPrompt = 'Base';

    const messages = [
      { role: 'system', content: 'Base' },
      { role: 'system', content: 'Skill' },
    ];

    const prompt = (agent as any).buildSystemPrompt(messages);
    expect(prompt).toContain('Base');
    expect(prompt).toContain('Extra');
    expect(prompt).toContain('Skill');
  });
});

describe('AgentLoop tool execution', () => {
  test('should inject cwd into tool input', async () => {
    const agent = new AgentLoop({ cwd: '/tmp/agent-cwd' });
    let receivedInput: Record<string, unknown> | undefined;

    (agent as any).toolRegistry.register(
      makeTool('spy'),
      async (input: Record<string, unknown>) => {
        receivedInput = input;
        return 'ok';
      }
    );

    await (agent as any).executeToolCalls([{ id: '1', name: 'spy', input: {} }]);

    expect(receivedInput?.cwd).toBe('/tmp/agent-cwd');
  });

  test('should apply updatedInput from PreToolUse hook', async () => {
    const agent = new AgentLoop({ cwd: '/tmp/base' });
    let receivedInput: Record<string, unknown> | undefined;

    (agent as any).toolRegistry.register(
      makeTool('spy'),
      async (input: Record<string, unknown>) => {
        receivedInput = input;
        return 'ok';
      }
    );

    (agent as any).hookLoader = {
      getHooks: (event: string) => (event === 'PreToolUse' ? ['pre'] : []),
    };

    (agent as any).hookExecutor = {
      execute: async (_hooks: unknown, input: any) => {
        if (input.hook_event_name === 'PreToolUse') {
          return { updatedInput: { command: 'ls', cwd: '/tmp/override' } };
        }
        return null;
      },
    };

    await (agent as any).executeToolCalls([{ id: '1', name: 'spy', input: {} }]);

    expect(receivedInput?.command).toBe('ls');
    expect(receivedInput?.cwd).toBe('/tmp/override');
  });

  test('should emit failure result when hook denies tool', async () => {
    const agent = new AgentLoop({ cwd: '/tmp/base' });
    const events: string[] = [];
    const toolResults: string[] = [];

    (agent as any).toolRegistry.register(makeTool('spy'), async () => 'ok');

    (agent as any).hookLoader = {
      getHooks: (event: string) => [event],
    };

    (agent as any).hookExecutor = {
      execute: async (_hooks: unknown, input: any) => {
        events.push(input.hook_event_name);
        if (input.hook_event_name === 'PreToolUse') {
          return { permissionDecision: 'deny', stopReason: 'nope' };
        }
        return null;
      },
    };

    (agent as any).onChunk = (chunk: any) => {
      if (chunk.type === 'tool_result') {
        toolResults.push(chunk.toolResult.content);
      }
    };

    const results = await (agent as any).executeToolCalls([{ id: '1', name: 'spy', input: {} }]);

    expect(results[0].isError).toBe(true);
    expect(toolResults[0]).toContain('nope');
    expect(events).toContain('PreToolUse');
    expect(events).toContain('PostToolUseFailure');
  });
});

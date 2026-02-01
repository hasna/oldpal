import type { HookHandler, HookInput, StreamChunk } from '@hasna/assistants-shared';
import { generateId, sleep } from '@hasna/assistants-shared';
import { AgentLoop } from './loop';

const DEFAULT_HOOK_TOOLS = ['read', 'glob', 'grep'];

export interface HookAgentOptions {
  hook: HookHandler;
  input: HookInput;
  timeout: number;
  cwd: string;
  allowedTools?: string[];
}

export async function runHookAgent(options: HookAgentOptions): Promise<string> {
  const { hook, input, timeout, cwd, allowedTools } = options;
  let response = '';

  const agent = new AgentLoop({
    cwd,
    sessionId: `hook-${generateId()}`,
    allowedTools: allowedTools ?? DEFAULT_HOOK_TOOLS,
    extraSystemPrompt: `You are a hook agent evaluating whether to allow an action.
Task: ${hook.prompt}

Respond with ALLOW or DENY on the first line, followed by a short reason.`,
    onChunk: (chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.content) {
        response += chunk.content;
      }
    },
  });

  await agent.initialize();

  const runPromise = agent.process(JSON.stringify(input)).catch(() => {});
  const timedOut = await Promise.race([
    runPromise.then(() => false),
    sleep(timeout).then(() => true),
  ]);

  if (timedOut) {
    agent.stop();
    return '';
  }

  await runPromise;
  return response.trim();
}

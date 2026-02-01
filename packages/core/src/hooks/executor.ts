import type { HookMatcher, HookHandler, HookInput, HookOutput, Message } from '@hasna/assistants-shared';
import type { LLMClient } from '../llm/client';
import { generateId, sleep } from '@hasna/assistants-shared';

function killSpawnedProcess(proc: { kill: () => void }): void {
  proc.kill();
}

type AgentRunner = (hook: HookHandler, input: HookInput, timeout: number) => Promise<string | null>;

/**
 * Hook executor - runs hooks and collects results
 */
export class HookExecutor {
  private llmClient?: LLMClient;
  private agentRunner?: AgentRunner;

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  setAgentRunner(runner: AgentRunner): void {
    this.agentRunner = runner;
  }

  /**
   * Execute hooks for an event
   */
  async execute(matchers: HookMatcher[], input: HookInput): Promise<HookOutput | null> {
    if (matchers.length === 0) {
      return null;
    }

    for (const matcher of matchers) {
      // Check if matcher matches the input
      if (!this.matchesPattern(matcher.matcher, input)) {
        continue;
      }

      // Execute all hooks in this matcher
      for (const hook of matcher.hooks) {
        const result = await this.executeHook(hook, input);

        // If hook returns a blocking result, stop processing
        if (result && result.continue === false) {
          return result;
        }

        // If hook returns a permission decision, use it
        if (result?.permissionDecision) {
          return result;
        }
      }
    }

    return null;
  }

  /**
   * Check if input matches the matcher pattern
   */
  private matchesPattern(pattern: string | undefined, input: HookInput): boolean {
    // Empty or wildcard pattern matches everything
    if (!pattern || pattern === '*' || pattern === '') {
      return true;
    }

    // Get the value to match against
    let value: string | undefined;

    switch (input.hook_event_name) {
      case 'PreToolUse':
      case 'PostToolUse':
      case 'PostToolUseFailure':
        value = input.tool_name;
        break;
      case 'SessionStart':
        value = input.source as string;
        break;
      case 'SessionEnd':
        value = input.reason as string;
        break;
      default:
        return true; // Events without matchers always match
    }

    if (!value) {
      return true;
    }

    // Try regex match
    try {
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(value);
    } catch {
      // Fall back to simple equality
      return value === pattern;
    }
  }

  /**
   * Execute a single hook
   */
  private async executeHook(hook: HookHandler, input: HookInput): Promise<HookOutput | null> {
    const timeout = hook.timeout || 30000;

    try {
      switch (hook.type) {
        case 'command':
          return await this.executeCommandHook(hook, input, timeout);
        case 'prompt':
          return await this.executePromptHook(hook, input, timeout);
        case 'agent':
          return await this.executeAgentHook(hook, input, timeout);
        default:
          return null;
      }
    } catch (error) {
      console.error(`Hook execution error:`, error);
      return null;
    }
  }

  /**
   * Execute a command hook
   */
  private async executeCommandHook(
    hook: HookHandler,
    input: HookInput,
    timeout: number
  ): Promise<HookOutput | null> {
    if (!hook.command) return null;

    try {
      // Run the command with input on stdin
      const proc = Bun.spawn(['bash', '-c', hook.command], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Write input as JSON to stdin
      const inputData = new TextEncoder().encode(JSON.stringify(input));
      proc.stdin.write(inputData);
      proc.stdin.end();

      // Set up timeout
      const timeoutId = setTimeout(killSpawnedProcess, timeout, proc);

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      clearTimeout(timeoutId);

      const exitCode = await proc.exited;

      // Exit code 0: success, parse JSON output
      if (exitCode === 0) {
        try {
          return JSON.parse(stdout.trim());
        } catch {
          // Not JSON, just return success
          return { continue: true, additionalContext: stdout.trim() };
        }
      }

      // Exit code 2: blocking error
      if (exitCode === 2) {
        return {
          continue: false,
          stopReason: stderr.trim() || 'Blocked by hook',
        };
      }

      // Other exit codes: non-blocking error
      return null;
    } catch (error) {
      console.error(`Command hook error:`, error);
      return null;
    }
  }

  /**
   * Execute a prompt hook (single-turn LLM decision)
   */
  private async executePromptHook(
    hook: HookHandler,
    input: HookInput,
    timeout: number
  ): Promise<HookOutput | null> {
    if (!hook.prompt || !this.llmClient) return null;

    const fullPrompt = `${hook.prompt}

Context:
${JSON.stringify(input, null, 2)}

Respond with JSON only: {"allow": boolean, "reason": string}`;

    try {
      const response = await this.completeWithTimeout(fullPrompt, timeout);
      const decision = this.parseDecision(response);
      if (!decision) return null;

      return {
        continue: decision.allow,
        stopReason: decision.allow ? undefined : decision.reason,
      };
    } catch (error) {
      console.error('Prompt hook error:', error);
      return null;
    }
  }

  /**
   * Execute an agent hook (multi-turn with tools)
   */
  private async executeAgentHook(
    hook: HookHandler,
    input: HookInput,
    timeout: number
  ): Promise<HookOutput | null> {
    if (!hook.prompt || !this.agentRunner) return null;

    try {
      const response = await this.agentRunner(hook, input, timeout);
      if (!response) return null;
      const decision = this.parseAllowDeny(response);
      if (!decision) return null;
      return {
        continue: decision.allow,
        stopReason: decision.allow ? undefined : decision.reason,
      };
    } catch (error) {
      console.error('Agent hook error:', error);
      return null;
    }
  }

  private parseDecision(raw: string): { allow: boolean; reason?: string } | null {
    const json = this.extractJson(raw);
    if (!json) return null;
    try {
      const parsed = JSON.parse(json) as { allow?: boolean; continue?: boolean; reason?: string };
      const allow = typeof parsed.allow === 'boolean' ? parsed.allow : parsed.continue;
      if (typeof allow !== 'boolean') return null;
      return { allow, reason: parsed.reason };
    } catch {
      return null;
    }
  }

  private parseAllowDeny(raw: string): { allow: boolean; reason?: string } | null {
    const tokenMatch = raw.match(/\b(ALLOW|DENY)\b/i);
    if (!tokenMatch) return null;
    const allow = tokenMatch[1].toUpperCase() === 'ALLOW';
    const reason = raw.replace(/\b(ALLOW|DENY)\b/i, '').trim() || undefined;
    return { allow, reason };
  }

  private extractJson(raw: string): string | null {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? match[0] : null;
  }

  private async completeWithTimeout(prompt: string, timeout: number): Promise<string> {
    const messages: Message[] = [
      { id: generateId(), role: 'user', content: prompt, timestamp: Date.now() },
    ];

    const deadline = Date.now() + timeout;
    let response = '';
    const iterator = this.llmClient!.chat(messages)[Symbol.asyncIterator]();

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error('timeout');
      }

      const next = await this.nextWithTimeout(iterator, remaining);
      if (next.done) break;

      const chunk = next.value;
      if (chunk.type === 'text' && chunk.content) {
        response += chunk.content;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error || 'llm error');
      }
    }

    await sleep(0);
    return response.trim();
  }

  private async nextWithTimeout<T>(
    iterator: AsyncIterator<T>,
    timeout: number
  ): Promise<IteratorResult<T>> {
    const result = await Promise.race([
      iterator.next(),
      sleep(timeout).then(() => ({ timeout: true } as const)),
    ]);

    if ('timeout' in result) {
      throw new Error('timeout');
    }

    return result as IteratorResult<T>;
  }
}

export const __test__ = {
  killSpawnedProcess,
};

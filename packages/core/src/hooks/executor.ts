import type { HookMatcher, HookHandler, HookInput, HookOutput } from '@oldpal/shared';

/**
 * Hook executor - runs hooks and collects results
 */
export class HookExecutor {
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
      const timeoutId = setTimeout(() => proc.kill(), timeout);

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
    if (!hook.prompt) return null;

    // TODO: Implement prompt hook with LLM call
    // For now, return null (no blocking)
    console.log(`Prompt hook: ${hook.prompt}`);
    return null;
  }

  /**
   * Execute an agent hook (multi-turn with tools)
   */
  private async executeAgentHook(
    hook: HookHandler,
    input: HookInput,
    timeout: number
  ): Promise<HookOutput | null> {
    if (!hook.prompt) return null;

    // TODO: Implement agent hook with subagent
    // For now, return null (no blocking)
    console.log(`Agent hook: ${hook.prompt}`);
    return null;
  }
}

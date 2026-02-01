import type { Tool, ToolCall, ToolResult } from '@oldpal/shared';
import { sleep } from '@oldpal/shared';

/**
 * Tool executor function type
 */
export type ToolExecutor = (input: Record<string, unknown>) => Promise<string>;

/**
 * Registered tool with executor
 */
interface RegisteredTool {
  tool: Tool;
  executor: ToolExecutor;
}

/**
 * Tool registry - manages available tools and their execution
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a tool
   */
  register(tool: Tool, executor: ToolExecutor): void {
    this.tools.set(tool.name, { tool, executor });
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get all registered tools
   */
  getTools(): Tool[] {
    const tools: Tool[] = [];
    for (const entry of this.tools.values()) {
      tools.push(entry.tool);
    }
    return tools;
  }

  /**
   * Get a specific tool
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  /**
   * Check if a tool is registered
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a tool call
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const registered = this.tools.get(toolCall.name);

    if (!registered) {
      return {
        toolCallId: toolCall.id,
        content: `Error: Tool "${toolCall.name}" not found`,
        isError: true,
        toolName: toolCall.name,
      };
    }

    try {
      const input = toolCall.input as Record<string, unknown>;
      const timeoutMsRaw = input?.timeoutMs ?? input?.timeout;
      const timeoutMsParsed = typeof timeoutMsRaw === 'string' ? Number(timeoutMsRaw) : timeoutMsRaw;
      const timeoutMs = typeof timeoutMsParsed === 'number' && timeoutMsParsed > 0 ? timeoutMsParsed : 60000;

      const result = await Promise.race([
        registered.executor(toolCall.input),
        sleep(timeoutMs).then(() => {
          throw new Error(`Tool timeout after ${Math.round(timeoutMs / 1000)}s`);
        }),
      ]);
      const isError = isErrorResult(result);
      return {
        toolCallId: toolCall.id,
        content: result,
        isError,
        toolName: toolCall.name,
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        content: `Error executing ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
        toolName: toolCall.name,
      };
    }
  }

  /**
   * Execute multiple tool calls in parallel
   */
  async executeAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const tasks: Promise<ToolResult>[] = [];
    for (const call of toolCalls) {
      tasks.push(this.execute(call));
    }
    return Promise.all(tasks);
  }
}

function isErrorResult(result: string): boolean {
  const trimmed = result.trim().toLowerCase();
  return (
    trimmed.startsWith('error') ||
    trimmed.startsWith('exit code') ||
    trimmed.startsWith('tool timeout') ||
    trimmed.startsWith('timed out')
  );
}

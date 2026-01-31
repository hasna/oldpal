import type { Tool, ToolCall, ToolResult } from '@oldpal/shared';
import { generateId } from '@oldpal/shared';

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
    return Array.from(this.tools.values()).map((t) => t.tool);
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
      };
    }

    try {
      const result = await registered.executor(toolCall.input);
      return {
        toolCallId: toolCall.id,
        content: result,
        isError: false,
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        content: `Error executing ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  /**
   * Execute multiple tool calls in parallel
   */
  async executeAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map((tc) => this.execute(tc)));
  }
}

import type { Tool, ToolCall, ToolResult } from '@oldpal/shared';
import { sleep } from '@oldpal/shared';
import { AssistantError, ErrorAggregator, ErrorCodes, ToolExecutionError } from '../errors';

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
  private errorAggregator?: ErrorAggregator;

  /**
   * Register a tool
   */
  register(tool: Tool, executor: ToolExecutor): void {
    this.tools.set(tool.name, { tool, executor });
  }

  /**
   * Attach an error aggregator for tool execution errors
   */
  setErrorAggregator(aggregator?: ErrorAggregator): void {
    this.errorAggregator = aggregator;
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
      const error = new ToolExecutionError(`Tool "${toolCall.name}" not found`, {
        toolName: toolCall.name,
        toolInput: toolCall.input,
        code: ErrorCodes.TOOL_NOT_FOUND,
        recoverable: false,
        retryable: false,
        suggestion: 'Check the tool name or list available tools with /tools.',
      });
      this.errorAggregator?.record(error);
      return {
        toolCallId: toolCall.id,
        content: formatToolError(error),
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
          throw new ToolExecutionError(`Tool timeout after ${Math.round(timeoutMs / 1000)}s`, {
            toolName: toolCall.name,
            toolInput: toolCall.input,
            code: ErrorCodes.TOOL_TIMEOUT,
            recoverable: true,
            retryable: true,
            suggestion: 'Try again or increase the timeout.',
          });
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
      const toolError = normalizeToolError(error, toolCall);
      if (toolError instanceof AssistantError) {
        this.errorAggregator?.record(toolError);
      }
      return {
        toolCallId: toolCall.id,
        content: formatToolError(toolError),
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

function normalizeToolError(error: unknown, toolCall: ToolCall): AssistantError {
  if (error instanceof AssistantError) return error;

  const message = error instanceof Error ? error.message : String(error);
  return new ToolExecutionError(`Error executing ${toolCall.name}: ${message}`, {
    toolName: toolCall.name,
    toolInput: toolCall.input,
    code: ErrorCodes.TOOL_EXECUTION_FAILED,
    recoverable: true,
    retryable: false,
  });
}

function formatToolError(error: AssistantError): string {
  if (error.suggestion) {
    return `${error.code}: ${error.message}\nSuggestion: ${error.suggestion}`;
  }
  return `${error.code}: ${error.message}`;
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

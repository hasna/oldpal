import type { Tool, ToolCall, ToolResult, ValidationConfig } from '@hasna/assistants-shared';
import { sleep } from '@hasna/assistants-shared';
import { AssistantError, ErrorAggregator, ErrorCodes, ToolExecutionError } from '../errors';
import { enforceToolOutputLimit, getLimits } from '../validation/limits';
import { validateToolInput, type ValidationMode } from '../validation/schema';
import { getSecurityLogger } from '../security/logger';

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
  private validationConfig?: ValidationConfig;

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
   * Configure validation behavior for tool inputs and outputs
   */
  setValidationConfig(config?: ValidationConfig): void {
    this.validationConfig = config;
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
      const validationMode = this.getValidationMode(toolCall.name);
      const validation = validateToolInput(toolCall.name, registered.tool.parameters, toolCall.input);
      const input = validation.coerced ?? (toolCall.input as Record<string, unknown>);

      if (!validation.valid) {
        const message = validation.errors?.map((err) => err.message).join('; ') || 'Invalid tool input';
        const error = new ToolExecutionError(message, {
          toolName: toolCall.name,
          toolInput: toolCall.input,
          code: ErrorCodes.VALIDATION_SCHEMA_ERROR,
          recoverable: false,
          retryable: false,
          suggestion: 'Review tool arguments and try again.',
        });
        if (validationMode === 'strict') {
          getSecurityLogger().log({
            eventType: 'validation_failure',
            severity: 'medium',
            details: {
              tool: toolCall.name,
              reason: message,
            },
            sessionId: (toolCall.input as Record<string, unknown>)?.sessionId as string || 'unknown',
          });
          this.errorAggregator?.record(error);
          return {
            toolCallId: toolCall.id,
            content: formatToolError(error),
            isError: true,
            toolName: toolCall.name,
          };
        }
      }

      const timeoutMsRaw = input?.timeoutMs ?? input?.timeout;
      const timeoutMsParsed = typeof timeoutMsRaw === 'string' ? Number(timeoutMsRaw) : timeoutMsRaw;
      let timeoutMs = typeof timeoutMsParsed === 'number' && timeoutMsParsed > 0 ? timeoutMsParsed : 60000;
      const derivedWaitTimeout = deriveWaitTimeoutMs(toolCall.name, input);
      if (derivedWaitTimeout !== null && derivedWaitTimeout > timeoutMs) {
        timeoutMs = derivedWaitTimeout;
      }

      const result = await Promise.race([
        registered.executor(input),
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
      const outputLimit = this.getToolOutputLimit(toolCall.name);
      const rawContent = typeof result === 'string' ? result : safeStringify(result);
      const content = enforceToolOutputLimit(rawContent, outputLimit);
      return {
        toolCallId: toolCall.id,
        content,
        rawContent,
        truncated: content !== rawContent,
        isError,
        toolName: toolCall.name,
      };
    } catch (error) {
      const toolError = normalizeToolError(error, toolCall);
      const outputLimit = this.getToolOutputLimit(toolCall.name);
      const rawContent = formatToolError(toolError);
      const content = enforceToolOutputLimit(rawContent, outputLimit);
      if (toolError instanceof AssistantError) {
        this.errorAggregator?.record(toolError);
      }
      return {
        toolCallId: toolCall.id,
        content,
        rawContent,
        truncated: content !== rawContent,
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

  private getValidationMode(toolName: string): ValidationMode {
    const config = this.validationConfig;
    return resolveMode(config?.mode as ValidationMode, config?.perTool?.[toolName]?.mode as ValidationMode | undefined);
  }

  private getToolOutputLimit(toolName: string): number {
    const config = this.validationConfig;
    const limits = getLimits();
    return config?.perTool?.[toolName]?.maxOutputLength ?? config?.maxToolOutputLength ?? limits.maxToolOutputLength;
  }
}

// Helpers
function resolveMode(defaultMode: ValidationMode | undefined, override?: ValidationMode): ValidationMode {
  return override ?? defaultMode ?? 'strict';
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const num = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(num)) return null;
  return num;
}

function deriveWaitTimeoutMs(toolName: string, input?: Record<string, unknown>): number | null {
  if (!input) return null;
  if (toolName !== 'wait' && toolName !== 'sleep') return null;

  const durationMs = toNumber(input.durationMs);
  if (durationMs !== null) {
    return clampWaitTimeout(durationMs);
  }

  const seconds = toNumber(input.seconds);
  if (seconds !== null) {
    return clampWaitTimeout(seconds * 1000);
  }

  const minutes = toNumber(input.minutes);
  if (minutes !== null) {
    return clampWaitTimeout(minutes * 60 * 1000);
  }

  const minSeconds = toNumber(input.minSeconds);
  const maxSeconds = toNumber(input.maxSeconds);
  if (minSeconds !== null && maxSeconds !== null) {
    return clampWaitTimeout(Math.max(minSeconds, maxSeconds) * 1000);
  }

  const minMinutes = toNumber(input.minMinutes);
  const maxMinutes = toNumber(input.maxMinutes);
  if (minMinutes !== null && maxMinutes !== null) {
    return clampWaitTimeout(Math.max(minMinutes, maxMinutes) * 60 * 1000);
  }

  return null;
}

function clampWaitTimeout(durationMs: number): number {
  const bufferMs = 5000;
  const maxMs = 7 * 24 * 60 * 60 * 1000;
  const safeDuration = Math.max(0, durationMs);
  const timeoutMs = safeDuration + bufferMs;
  return Math.min(timeoutMs, maxMs);
}

export const __test__ = {
  deriveWaitTimeoutMs,
  clampWaitTimeout,
};

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

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
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

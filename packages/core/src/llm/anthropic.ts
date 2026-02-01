import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { LLMClient } from './client';
import type { Message, Tool, StreamChunk, LLMConfig, ToolCall } from '@oldpal/shared';
import { generateId } from '@oldpal/shared';

/**
 * Load API key from ~/.secrets file if not in environment
 */
function loadApiKeyFromSecrets(): string | undefined {
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();
  const secretsPath = join(homeDir, '.secrets');
  if (existsSync(secretsPath)) {
    try {
      const content = readFileSync(secretsPath, 'utf-8');
      const match = content.match(/export\s+ANTHROPIC_API_KEY\s*=\s*["']?([^"'\n]+)["']?/);
      if (match) {
        return match[1];
      }
    } catch {
      // Ignore errors reading secrets file
    }
  }
  return undefined;
}

/**
 * Anthropic Claude client
 */
export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || loadApiKeyFromSecrets();

    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY not found. Please either:\n' +
        '  1. Set the ANTHROPIC_API_KEY environment variable, or\n' +
        '  2. Add it to ~/.secrets: export ANTHROPIC_API_KEY="your-key"'
      );
    }

    this.client = new Anthropic({ apiKey });
    this.model = config.model;
    this.maxTokens = config.maxTokens || 8192;
  }

  getModel(): string {
    return this.model;
  }

  async *chat(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string
  ): AsyncGenerator<StreamChunk> {
    // Convert messages to Anthropic format
    const anthropicMessages = this.convertMessages(messages);

    // Convert tools to Anthropic format
    const anthropicTools = tools ? this.convertTools(tools) : undefined;

    try {
      const combinedSystem =
        systemPrompt && systemPrompt.trim().length > 0
          ? `${this.getDefaultSystemPrompt()}\n\n---\n\n${systemPrompt}`
          : this.getDefaultSystemPrompt();

      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: this.maxTokens,
        system: combinedSystem,
        messages: anthropicMessages,
        tools: anthropicTools,
      });

      let currentToolCall: Partial<ToolCall> | null = null;
      let toolInputJson = '';

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentToolCall = {
              id: event.content_block.id,
              name: event.content_block.name,
            };
            toolInputJson = '';
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield {
              type: 'text',
              content: event.delta.text,
            };
          } else if (event.delta.type === 'input_json_delta') {
            toolInputJson += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolCall && currentToolCall.id && currentToolCall.name) {
            try {
              currentToolCall.input = toolInputJson ? JSON.parse(toolInputJson) : {};
            } catch {
              currentToolCall.input = {};
            }
            yield {
              type: 'tool_use',
              toolCall: currentToolCall as ToolCall,
            };
            currentToolCall = null;
            toolInputJson = '';
          }
        } else if (event.type === 'message_stop') {
          yield { type: 'done' };
        }
      }

      // Get final usage from stream
      const finalMessage = await stream.finalMessage();
      if (finalMessage.usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
            totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
            maxContextTokens: 200000,
          },
        };
      }
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    // Track tool_use IDs from assistant messages to validate tool_results
    const pendingToolUseIds = new Set<string>();

    for (const msg of messages) {
      if (msg.role === 'system') continue; // System messages handled separately

      // Build content array with proper types
      const content: Array<
        | Anthropic.TextBlockParam
        | Anthropic.ToolUseBlockParam
        | Anthropic.ToolResultBlockParam
      > = [];

      // Add text content
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }

      // Add tool use blocks (for assistant messages)
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input as Record<string, unknown>,
          });
          pendingToolUseIds.add(toolCall.id);
        }
      }

      // Add tool results (for user messages following tool use)
      // Only include results that have a corresponding tool_use in this conversation
      if (msg.toolResults) {
        for (const toolResult of msg.toolResults) {
          // Only add if we have a corresponding tool_use
          if (pendingToolUseIds.has(toolResult.toolCallId)) {
            content.push({
              type: 'tool_result',
              tool_use_id: toolResult.toolCallId,
              content: toolResult.content,
              is_error: toolResult.isError,
            });
            pendingToolUseIds.delete(toolResult.toolCallId);
          }
          // Skip orphaned tool_results to avoid API errors
        }
      }

      if (content.length > 0) {
        result.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: content as Anthropic.MessageParam['content'],
        });
      }
    }

    return result;
  }

  private convertTools(tools: Tool[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }

  private getDefaultSystemPrompt(): string {
    return `You are a helpful personal AI assistant running in the terminal.

You have access to various tools and connectors:
- Connectors for Notion, Google Drive, Gmail, Calendar, Linear, Slack
- Filesystem operations (read, write, search files)
- Shell command execution

Guidelines:
- Be concise and direct
- Don't introduce yourself or say your name
- Use tools proactively to accomplish tasks
- Format output nicely for the terminal (use markdown)
- If a task requires multiple steps, break it down clearly

Current date: ${new Date().toISOString().split('T')[0]}`;
  }
}

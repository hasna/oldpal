import type { Message, ToolCall, ToolResult } from '@oldpal/shared';
import { generateId, now } from '@oldpal/shared';

/**
 * Agent context - manages conversation state
 */
export class AgentContext {
  private messages: Message[] = [];
  private maxMessages: number;

  constructor(maxMessages: number = 100) {
    this.maxMessages = maxMessages;
  }

  /**
   * Add a user message
   */
  addUserMessage(content: string): Message {
    const message: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: now(),
    };
    this.messages.push(message);
    this.prune();
    return message;
  }

  /**
   * Add an assistant message
   */
  addAssistantMessage(content: string, toolCalls?: ToolCall[]): Message {
    const message: Message = {
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: now(),
      toolCalls,
    };
    this.messages.push(message);
    this.prune();
    return message;
  }

  /**
   * Add tool results as a user message
   */
  addToolResults(results: ToolResult[]): Message {
    const message: Message = {
      id: generateId(),
      role: 'user',
      content: '',
      timestamp: now(),
      toolResults: results,
    };
    this.messages.push(message);
    this.prune();
    return message;
  }

  /**
   * Add a system message
   */
  addSystemMessage(content: string): Message {
    const message: Message = {
      id: generateId(),
      role: 'system',
      content,
      timestamp: now(),
    };
    this.messages.push(message);
    return message;
  }

  /**
   * Get all messages
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get the last N messages
   */
  getLastMessages(n: number): Message[] {
    return this.messages.slice(-n);
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Prune old messages if over limit
   */
  private prune(): void {
    if (this.messages.length > this.maxMessages) {
      // Keep system messages and recent messages
      const systemMessages = this.messages.filter((m) => m.role === 'system');
      const recentMessages = this.messages
        .filter((m) => m.role !== 'system')
        .slice(-(this.maxMessages - systemMessages.length));
      this.messages = [...systemMessages, ...recentMessages];
    }
  }

  /**
   * Export context for persistence
   */
  export(): Message[] {
    return this.messages;
  }

  /**
   * Import context from persistence
   */
  import(messages: Message[]): void {
    this.messages = messages;
  }
}

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
   * Update maximum message count
   */
  setMaxMessages(maxMessages: number): void {
    this.maxMessages = maxMessages;
    this.prune();
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
   * Ensures tool_use/tool_result pairs are kept together
   */
  private prune(): void {
    if (this.messages.length <= this.maxMessages) {
      return;
    }

    // Keep system messages
    const systemMessages = this.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = this.messages.filter((m) => m.role !== 'system');

    const targetCount = this.maxMessages - systemMessages.length;
    let recentMessages = nonSystemMessages.slice(-targetCount);

    // Ensure we don't start with tool_results (orphaned from their tool_use)
    // If the first message has tool_results, we need to find its corresponding
    // assistant message with tool_use
    while (recentMessages.length > 0 && recentMessages[0].toolResults) {
      // Find the previous assistant message that has the matching tool_use
      const firstIndex = nonSystemMessages.indexOf(recentMessages[0]);
      if (firstIndex > 0) {
        // Include the previous message
        recentMessages = nonSystemMessages.slice(firstIndex - 1);
        // But limit to target count + 1 to include the pair
        if (recentMessages.length > targetCount + 1) {
          recentMessages = recentMessages.slice(-(targetCount + 1));
        }
      } else {
        // Can't find the matching message, remove the orphan
        recentMessages = recentMessages.slice(1);
      }
    }

    this.messages = [...systemMessages, ...recentMessages];
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

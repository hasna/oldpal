/**
 * MessagesManager - Core class for agent-to-agent messaging
 * Handles sending, receiving, listing, and context injection of messages
 */

import { generateId } from '@hasna/assistants-shared';
import { LocalMessagesStorage, getMessagesBasePath } from './storage/local-storage';
import type {
  AgentMessage,
  MessageListItem,
  MessageThread,
  SendMessageInput,
  MessagesOperationResult,
  MessagesConfig,
  MessagePriority,
} from './types';

export interface MessagesManagerOptions {
  /** Agent ID */
  agentId: string;
  /** Agent name */
  agentName: string;
  /** Messages configuration */
  config: MessagesConfig;
}

/**
 * Priority order for comparison
 */
const PRIORITY_ORDER: Record<MessagePriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

/**
 * Generate a message ID
 */
function generateMessageId(): string {
  return `msg_${generateId().slice(0, 8)}`;
}

/**
 * Generate a thread ID
 */
function generateThreadId(): string {
  return `thread_${generateId().slice(0, 8)}`;
}

/**
 * MessagesManager handles all messaging operations for an agent
 */
export class MessagesManager {
  private agentId: string;
  private agentName: string;
  private config: MessagesConfig;
  private storage: LocalMessagesStorage;

  constructor(options: MessagesManagerOptions) {
    this.agentId = options.agentId;
    this.agentName = options.agentName;
    this.config = options.config;

    this.storage = new LocalMessagesStorage({
      basePath: options.config.storage?.basePath || getMessagesBasePath(),
    });
  }

  /**
   * Initialize the manager (register agent)
   */
  async initialize(): Promise<void> {
    await this.storage.registerAgent(this.agentId, this.agentName);
  }

  // ============================================
  // Message Operations
  // ============================================

  /**
   * Send a message to another agent
   */
  async send(input: SendMessageInput): Promise<MessagesOperationResult> {
    try {
      // Resolve recipient
      const recipient = await this.resolveRecipient(input.to);
      if (!recipient) {
        return {
          success: false,
          message: `Agent "${input.to}" not found. Use messages_list_agents to see known agents.`,
        };
      }

      // Handle reply
      let threadId: string;
      let parentId: string | null = null;
      let subject = input.subject;

      if (input.replyTo) {
        const parentMessage = await this.storage.loadMessage(this.agentId, input.replyTo);
        if (!parentMessage) {
          return {
            success: false,
            message: `Message "${input.replyTo}" not found.`,
          };
        }
        threadId = parentMessage.threadId;
        parentId = parentMessage.id;
        if (!subject && parentMessage.subject) {
          subject = parentMessage.subject.startsWith('Re: ')
            ? parentMessage.subject
            : `Re: ${parentMessage.subject}`;
        }
      } else {
        threadId = generateThreadId();
      }

      const messageId = generateMessageId();
      const now = new Date().toISOString();

      const message: AgentMessage = {
        id: messageId,
        threadId,
        parentId,
        fromAgentId: this.agentId,
        fromAgentName: this.agentName,
        toAgentId: recipient.id,
        toAgentName: recipient.name,
        subject,
        body: input.body,
        priority: input.priority || 'normal',
        status: 'unread',
        createdAt: now,
        metadata: input.metadata,
      };

      // Save to recipient's inbox
      await this.storage.saveMessage(message);

      // Update sender's registry
      await this.storage.registerAgent(this.agentId, this.agentName);

      return {
        success: true,
        message: `Message sent to ${recipient.name}`,
        messageId,
        threadId,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Resolve a recipient (by ID or name)
   */
  private async resolveRecipient(to: string): Promise<{ id: string; name: string } | null> {
    // Try by ID first
    const byId = await this.storage.getAgentById(to);
    if (byId) {
      return { id: to, name: byId.name };
    }

    // Try by name
    const byName = await this.storage.findAgentByName(to);
    if (byName) {
      return { id: byName.id, name: byName.entry.name };
    }

    return null;
  }

  /**
   * List messages in inbox
   */
  async list(options?: {
    limit?: number;
    unreadOnly?: boolean;
    threadId?: string;
    from?: string;
  }): Promise<MessageListItem[]> {
    let fromAgentId: string | undefined;

    if (options?.from) {
      const agent = await this.resolveRecipient(options.from);
      fromAgentId = agent?.id;
    }

    return this.storage.listMessages(this.agentId, {
      limit: options?.limit,
      unreadOnly: options?.unreadOnly,
      threadId: options?.threadId,
      fromAgentId,
    });
  }

  /**
   * Read a specific message
   */
  async read(messageId: string): Promise<AgentMessage | null> {
    const message = await this.storage.loadMessage(this.agentId, messageId);

    if (message && (message.status === 'unread' || message.status === 'injected')) {
      await this.storage.updateMessageStatus(
        this.agentId,
        messageId,
        'read',
        new Date().toISOString()
      );
      message.status = 'read';
      message.readAt = new Date().toISOString();
    }

    return message;
  }

  /**
   * Read an entire thread
   */
  async readThread(threadId: string): Promise<AgentMessage[]> {
    const messages = await this.storage.loadThreadMessages(this.agentId, threadId);

    // Mark all as read
    for (const message of messages) {
      if (message.status === 'unread' || message.status === 'injected') {
        await this.storage.updateMessageStatus(
          this.agentId,
          message.id,
          'read',
          new Date().toISOString()
        );
        message.status = 'read';
        message.readAt = new Date().toISOString();
      }
    }

    return messages;
  }

  /**
   * Delete a message
   */
  async delete(messageId: string): Promise<MessagesOperationResult> {
    const deleted = await this.storage.deleteMessage(this.agentId, messageId);

    if (deleted) {
      return {
        success: true,
        message: `Message ${messageId} deleted.`,
      };
    }

    return {
      success: false,
      message: `Message ${messageId} not found.`,
    };
  }

  /**
   * List conversation threads
   */
  async listThreads(): Promise<MessageThread[]> {
    return this.storage.listThreads(this.agentId);
  }

  /**
   * List known agents
   */
  async listAgents(): Promise<Array<{ id: string; name: string; lastSeen: string }>> {
    const agents = await this.storage.listAgents();
    // Filter out self
    return agents.filter((a) => a.id !== this.agentId);
  }

  /**
   * Get inbox statistics
   */
  async getStats(): Promise<{
    totalMessages: number;
    unreadCount: number;
    threadCount: number;
  }> {
    const index = await this.storage.loadIndex(this.agentId);
    return index.stats;
  }

  // ============================================
  // Context Injection
  // ============================================

  /**
   * Get unread messages for context injection
   */
  async getUnreadForInjection(): Promise<AgentMessage[]> {
    const injectionConfig = this.config.injection || {};
    if (injectionConfig.enabled === false) {
      return [];
    }

    const maxPerTurn = injectionConfig.maxPerTurn || 5;
    const minPriority = injectionConfig.minPriority || 'low';
    const minPriorityOrder = PRIORITY_ORDER[minPriority];

    // Get unread messages
    const unread = await this.storage.listMessages(this.agentId, {
      unreadOnly: true,
    });

    // Filter by priority and exclude already-injected messages
    const filtered = unread.filter(
      (m) => m.status === 'unread' && PRIORITY_ORDER[m.priority] >= minPriorityOrder
    );

    // Sort by priority (high first) then by date (oldest first)
    filtered.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Limit
    const toInject = filtered.slice(0, maxPerTurn);

    // Load full messages
    const messages: AgentMessage[] = [];
    for (const item of toInject) {
      const message = await this.storage.loadMessage(this.agentId, item.id);
      if (message) {
        messages.push(message);
      }
    }

    return messages;
  }

  /**
   * Mark messages as injected
   */
  async markInjected(messageIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const id of messageIds) {
      await this.storage.updateMessageStatus(this.agentId, id, 'injected', now);
    }
  }

  /**
   * Build context string for injection
   */
  buildInjectionContext(messages: AgentMessage[]): string {
    if (messages.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push('## Pending Agent Messages');
    lines.push('');
    lines.push(`You have ${messages.length} unread message(s):`);

    for (const msg of messages) {
      lines.push('');
      lines.push(`### From: ${msg.fromAgentName}`);
      if (msg.subject) {
        lines.push(`**Subject:** ${msg.subject}`);
      }
      lines.push(`**Priority:** ${msg.priority} | **Sent:** ${formatDate(msg.createdAt)}`);
      lines.push('');
      lines.push(msg.body);
      lines.push(`*Message ID: ${msg.id}*`);
      if (msg.threadId !== msg.id.replace('msg_', 'thread_')) {
        lines.push(`*Thread: ${msg.threadId}*`);
      }
      lines.push('---');
    }

    lines.push('');
    lines.push('Use messages_read to mark as read, or messages_send to reply.');

    return lines.join('\n');
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up old messages
   */
  async cleanup(): Promise<number> {
    const maxAgeDays = this.config.storage?.maxAgeDays || 90;
    const maxMessages = this.config.storage?.maxMessages || 1000;

    let deleted = await this.storage.cleanup(this.agentId, maxAgeDays);
    deleted += await this.storage.enforceMaxMessages(this.agentId, maxMessages);

    return deleted;
  }
}

/**
 * Format a date for display
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleString();
}

/**
 * Create a MessagesManager from config
 */
export function createMessagesManager(
  agentId: string,
  agentName: string,
  config: MessagesConfig
): MessagesManager {
  return new MessagesManager({
    agentId,
    agentName,
    config,
  });
}

/**
 * Local JSON file storage for agent messages
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdir, readdir, rm, stat } from 'fs/promises';
import type {
  AgentMessage,
  AgentRegistry,
  AgentRegistryEntry,
  InboxIndex,
  MessageListItem,
  MessageThread,
} from '../types';
import { getRuntime } from '../../runtime';

export interface LocalStorageOptions {
  /** Base path for storage (default: ~/.assistants/messages) */
  basePath?: string;
}

/**
 * Get the default messages storage path
 */
export function getMessagesBasePath(): string {
  const envOverride = process.env.ASSISTANTS_DIR;
  const home = envOverride && envOverride.trim() ? envOverride : homedir();
  return join(home, '.assistants', 'messages');
}

/**
 * Pattern for safe IDs - only alphanumeric, hyphens, and underscores allowed
 */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Local storage for agent messages using JSON files
 */
export class LocalMessagesStorage {
  private basePath: string;

  constructor(options: LocalStorageOptions = {}) {
    this.basePath = options.basePath || getMessagesBasePath();
  }

  /**
   * Validate that an ID is safe to use in filesystem paths.
   * Throws an error if the ID contains path separators or traversal sequences.
   */
  private validateSafeId(id: string, idType: string): void {
    if (!id || typeof id !== 'string') {
      throw new Error(`Invalid ${idType}: must be a non-empty string`);
    }
    if (!SAFE_ID_PATTERN.test(id)) {
      throw new Error(
        `Invalid ${idType}: "${id}" contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.`
      );
    }
  }

  /**
   * Ensure the storage directories exist
   */
  async ensureDirectories(agentId: string): Promise<void> {
    const agentPath = this.getAgentPath(agentId);
    await Promise.all([
      mkdir(this.basePath, { recursive: true }),
      mkdir(join(agentPath, 'messages'), { recursive: true }),
      mkdir(join(agentPath, 'threads'), { recursive: true }),
    ]);
  }

  // ============================================
  // Path Helpers
  // ============================================

  private getAgentPath(agentId: string): string {
    this.validateSafeId(agentId, 'agentId');
    return join(this.basePath, agentId);
  }

  private getIndexPath(agentId: string): string {
    return join(this.getAgentPath(agentId), 'index.json');
  }

  private getMessagePath(agentId: string, messageId: string): string {
    this.validateSafeId(messageId, 'messageId');
    return join(this.getAgentPath(agentId), 'messages', `${messageId}.json`);
  }

  private getThreadPath(agentId: string, threadId: string): string {
    this.validateSafeId(threadId, 'threadId');
    return join(this.getAgentPath(agentId), 'threads', `${threadId}.json`);
  }

  private getRegistryPath(): string {
    return join(this.basePath, 'registry.json');
  }

  // ============================================
  // Agent Registry Operations
  // ============================================

  /**
   * Load the global agent registry
   */
  async loadRegistry(): Promise<AgentRegistry> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getRegistryPath());
      if (!(await file.exists())) {
        return { agents: {} };
      }
      return await file.json();
    } catch {
      return { agents: {} };
    }
  }

  /**
   * Save the global agent registry
   */
  async saveRegistry(registry: AgentRegistry): Promise<void> {
    const runtime = getRuntime();
    await mkdir(this.basePath, { recursive: true });
    await runtime.write(this.getRegistryPath(), JSON.stringify(registry, null, 2));
  }

  /**
   * Register or update an agent in the registry
   */
  async registerAgent(agentId: string, name: string): Promise<void> {
    const registry = await this.loadRegistry();
    registry.agents[agentId] = {
      name,
      lastSeen: new Date().toISOString(),
    };
    await this.saveRegistry(registry);
  }

  /**
   * Get agent info by ID
   */
  async getAgentById(agentId: string): Promise<AgentRegistryEntry | null> {
    const registry = await this.loadRegistry();
    return registry.agents[agentId] || null;
  }

  /**
   * Find agent by name (case-insensitive)
   */
  async findAgentByName(name: string): Promise<{ id: string; entry: AgentRegistryEntry } | null> {
    const registry = await this.loadRegistry();
    const lowerName = name.toLowerCase();

    for (const [id, entry] of Object.entries(registry.agents)) {
      if (entry.name.toLowerCase() === lowerName) {
        return { id, entry };
      }
    }

    return null;
  }

  /**
   * List all known agents
   */
  async listAgents(): Promise<Array<{ id: string; name: string; lastSeen: string }>> {
    const registry = await this.loadRegistry();
    return Object.entries(registry.agents).map(([id, entry]) => ({
      id,
      name: entry.name,
      lastSeen: entry.lastSeen,
    }));
  }

  // ============================================
  // Inbox Index Operations
  // ============================================

  /**
   * Load inbox index for an agent
   */
  async loadIndex(agentId: string): Promise<InboxIndex> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getIndexPath(agentId));
      if (!(await file.exists())) {
        return {
          messages: [],
          lastCheck: new Date().toISOString(),
          stats: {
            totalMessages: 0,
            unreadCount: 0,
            threadCount: 0,
          },
        };
      }
      return await file.json();
    } catch {
      return {
        messages: [],
        lastCheck: new Date().toISOString(),
        stats: {
          totalMessages: 0,
          unreadCount: 0,
          threadCount: 0,
        },
      };
    }
  }

  /**
   * Save inbox index for an agent
   */
  async saveIndex(agentId: string, index: InboxIndex): Promise<void> {
    const runtime = getRuntime();
    await this.ensureDirectories(agentId);
    await runtime.write(this.getIndexPath(agentId), JSON.stringify(index, null, 2));
  }

  /**
   * Update index after message operations
   */
  private async rebuildIndexStats(agentId: string, index: InboxIndex): Promise<void> {
    const threadIds = new Set<string>();
    let unreadCount = 0;

    for (const msg of index.messages) {
      threadIds.add(msg.threadId);
      if (msg.status === 'unread' || msg.status === 'injected') {
        unreadCount++;
      }
    }

    index.stats = {
      totalMessages: index.messages.length,
      unreadCount,
      threadCount: threadIds.size,
    };
    index.lastCheck = new Date().toISOString();
  }

  // ============================================
  // Message Operations
  // ============================================

  /**
   * Save a message to storage
   */
  async saveMessage(message: AgentMessage): Promise<void> {
    const runtime = getRuntime();
    await this.ensureDirectories(message.toAgentId);

    // Save full message
    const messagePath = this.getMessagePath(message.toAgentId, message.id);
    await runtime.write(messagePath, JSON.stringify(message, null, 2));

    // Update index
    const index = await this.loadIndex(message.toAgentId);

    const listItem: MessageListItem = {
      id: message.id,
      threadId: message.threadId,
      parentId: message.parentId,
      fromAgentId: message.fromAgentId,
      fromAgentName: message.fromAgentName,
      subject: message.subject,
      preview: message.body.slice(0, 100) + (message.body.length > 100 ? '...' : ''),
      priority: message.priority,
      status: message.status,
      createdAt: message.createdAt,
      replyCount: 0,
    };

    // Add to index (prepend for most recent first)
    index.messages.unshift(listItem);

    // Update reply counts for thread
    if (message.parentId) {
      for (const msg of index.messages) {
        if (msg.threadId === message.threadId && msg.id !== message.id) {
          msg.replyCount = (msg.replyCount || 0) + 1;
        }
      }
    }

    await this.rebuildIndexStats(message.toAgentId, index);
    await this.saveIndex(message.toAgentId, index);

    // Update thread metadata
    await this.updateThread(message.toAgentId, message);
  }

  /**
   * Load a specific message
   */
  async loadMessage(agentId: string, messageId: string): Promise<AgentMessage | null> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getMessagePath(agentId, messageId));
      if (!(await file.exists())) {
        return null;
      }
      return await file.json();
    } catch {
      return null;
    }
  }

  /**
   * Update message status
   */
  async updateMessageStatus(
    agentId: string,
    messageId: string,
    status: AgentMessage['status'],
    timestamp?: string
  ): Promise<void> {
    const runtime = getRuntime();
    const message = await this.loadMessage(agentId, messageId);
    if (!message) return;

    message.status = status;
    if (status === 'read' && timestamp) {
      message.readAt = timestamp;
    } else if (status === 'injected' && timestamp) {
      message.injectedAt = timestamp;
    }

    await runtime.write(
      this.getMessagePath(agentId, messageId),
      JSON.stringify(message, null, 2)
    );

    // Update index
    const index = await this.loadIndex(agentId);
    const indexItem = index.messages.find((m) => m.id === messageId);
    if (indexItem) {
      indexItem.status = status;
    }
    await this.rebuildIndexStats(agentId, index);
    await this.saveIndex(agentId, index);
  }

  /**
   * Delete a message
   */
  async deleteMessage(agentId: string, messageId: string): Promise<boolean> {
    const runtime = getRuntime();
    const messagePath = this.getMessagePath(agentId, messageId);
    try {
      const file = runtime.file(messagePath);
      if (!(await file.exists())) {
        return false;
      }

      await rm(messagePath);

      // Update index
      const index = await this.loadIndex(agentId);
      const msgIndex = index.messages.findIndex((m) => m.id === messageId);
      if (msgIndex >= 0) {
        index.messages.splice(msgIndex, 1);
        await this.rebuildIndexStats(agentId, index);
        await this.saveIndex(agentId, index);
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * List messages for an agent
   */
  async listMessages(
    agentId: string,
    options?: {
      limit?: number;
      unreadOnly?: boolean;
      threadId?: string;
      fromAgentId?: string;
    }
  ): Promise<MessageListItem[]> {
    const index = await this.loadIndex(agentId);
    let messages = [...index.messages];

    // Apply filters
    if (options?.unreadOnly) {
      messages = messages.filter((m) => m.status === 'unread' || m.status === 'injected');
    }
    if (options?.threadId) {
      messages = messages.filter((m) => m.threadId === options.threadId);
    }
    if (options?.fromAgentId) {
      messages = messages.filter((m) => m.fromAgentId === options.fromAgentId);
    }

    // Apply limit
    if (options?.limit && options.limit > 0) {
      messages = messages.slice(0, options.limit);
    }

    return messages;
  }

  // ============================================
  // Thread Operations
  // ============================================

  /**
   * Update thread metadata
   */
  private async updateThread(agentId: string, message: AgentMessage): Promise<void> {
    const runtime = getRuntime();
    const threadPath = this.getThreadPath(agentId, message.threadId);
    let thread: MessageThread;

    try {
      const file = runtime.file(threadPath);
      if (await file.exists()) {
        thread = await file.json();
      } else {
        thread = {
          threadId: message.threadId,
          subject: message.subject,
          participants: [],
          messageCount: 0,
          unreadCount: 0,
          lastMessage: {} as MessageListItem,
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
        };
      }
    } catch {
      thread = {
        threadId: message.threadId,
        subject: message.subject,
        participants: [],
        messageCount: 0,
        unreadCount: 0,
        lastMessage: {} as MessageListItem,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      };
    }

    // Update participants
    const fromExists = thread.participants.some((p) => p.agentId === message.fromAgentId);
    if (!fromExists) {
      thread.participants.push({
        agentId: message.fromAgentId,
        agentName: message.fromAgentName,
      });
    }
    const toExists = thread.participants.some((p) => p.agentId === message.toAgentId);
    if (!toExists) {
      thread.participants.push({
        agentId: message.toAgentId,
        agentName: message.toAgentName,
      });
    }

    // Update counts
    thread.messageCount++;
    if (message.status === 'unread') {
      thread.unreadCount++;
    }

    // Update last message
    thread.lastMessage = {
      id: message.id,
      threadId: message.threadId,
      parentId: message.parentId,
      fromAgentId: message.fromAgentId,
      fromAgentName: message.fromAgentName,
      subject: message.subject,
      preview: message.body.slice(0, 100) + (message.body.length > 100 ? '...' : ''),
      priority: message.priority,
      status: message.status,
      createdAt: message.createdAt,
      replyCount: 0,
    };

    thread.updatedAt = message.createdAt;

    await runtime.write(threadPath, JSON.stringify(thread, null, 2));
  }

  /**
   * Load thread metadata
   */
  async loadThread(agentId: string, threadId: string): Promise<MessageThread | null> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getThreadPath(agentId, threadId));
      if (!(await file.exists())) {
        return null;
      }
      return await file.json();
    } catch {
      return null;
    }
  }

  /**
   * List all threads for an agent
   */
  async listThreads(agentId: string): Promise<MessageThread[]> {
    const runtime = getRuntime();
    const agentPath = this.getAgentPath(agentId);
    const threadsDir = join(agentPath, 'threads');

    try {
      const files = await readdir(threadsDir);
      const threads: MessageThread[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const threadFile = runtime.file(join(threadsDir, file));
          const thread = await threadFile.json<MessageThread>();
          threads.push(thread);
        } catch {
          // Skip invalid files
        }
      }

      // Sort by most recent update
      threads.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      return threads;
    } catch {
      return [];
    }
  }

  /**
   * Load all messages in a thread
   */
  async loadThreadMessages(agentId: string, threadId: string): Promise<AgentMessage[]> {
    const index = await this.loadIndex(agentId);
    const threadMessageIds = index.messages
      .filter((m) => m.threadId === threadId)
      .map((m) => m.id);

    const messages: AgentMessage[] = [];
    for (const id of threadMessageIds) {
      const message = await this.loadMessage(agentId, id);
      if (message) {
        messages.push(message);
      }
    }

    // Sort by creation time (oldest first for reading)
    messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return messages;
  }

  // ============================================
  // Cleanup Operations
  // ============================================

  /**
   * Clean up old messages
   */
  async cleanup(agentId: string, maxAgeDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffTime = cutoffDate.getTime();

    const index = await this.loadIndex(agentId);
    const toDelete: string[] = [];

    for (const msg of index.messages) {
      const msgTime = new Date(msg.createdAt).getTime();
      if (msgTime < cutoffTime) {
        toDelete.push(msg.id);
      }
    }

    for (const id of toDelete) {
      await this.deleteMessage(agentId, id);
    }

    return toDelete.length;
  }

  /**
   * Enforce max messages limit
   */
  async enforceMaxMessages(agentId: string, maxMessages: number): Promise<number> {
    const index = await this.loadIndex(agentId);
    if (index.messages.length <= maxMessages) {
      return 0;
    }

    // Sort by date (oldest first)
    const sorted = [...index.messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const toDelete = sorted.slice(0, index.messages.length - maxMessages);

    for (const msg of toDelete) {
      await this.deleteMessage(agentId, msg.id);
    }

    return toDelete.length;
  }
}

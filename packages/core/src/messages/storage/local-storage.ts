/**
 * Local JSON file storage for assistant messages
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdir, readdir, rm, open, readFile } from 'fs/promises';
import type {
  AssistantMessage,
  AssistantRegistry,
  AssistantRegistryEntry,
  InboxIndex,
  MessageListItem,
  MessageThread,
} from '../types';
import { getRuntime } from '../../runtime';
import { atomicWriteFile } from '../../utils/atomic-write';
import { generateId } from '@hasna/assistants-shared';

const INDEX_LOCK_FILE = 'index.lock.json';
const INDEX_LOCK_TTL_MS = 10 * 1000;
const INDEX_LOCK_RETRIES = 2;

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
 * Local storage for assistant messages using JSON files
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
  async ensureDirectories(assistantId: string): Promise<void> {
    const assistantPath = this.getAssistantPath(assistantId);
    await Promise.all([
      mkdir(this.basePath, { recursive: true }),
      mkdir(join(assistantPath, 'messages'), { recursive: true }),
      mkdir(join(assistantPath, 'threads'), { recursive: true }),
    ]);
  }

  // ============================================
  // Path Helpers
  // ============================================

  private getAssistantPath(assistantId: string): string {
    this.validateSafeId(assistantId, 'assistantId');
    return join(this.basePath, assistantId);
  }

  private getIndexLockPath(assistantId: string): string {
    return join(this.getAssistantPath(assistantId), INDEX_LOCK_FILE);
  }

  private async acquireIndexLock(
    assistantId: string,
    ownerId: string,
    ttlMs: number = INDEX_LOCK_TTL_MS,
    retryDepth: number = 0
  ): Promise<boolean> {
    if (retryDepth >= INDEX_LOCK_RETRIES) return false;
    await this.ensureDirectories(assistantId);
    const path = this.getIndexLockPath(assistantId);
    const now = Date.now();

    try {
      const handle = await open(path, 'wx');
      await handle.writeFile(JSON.stringify({ ownerId, createdAt: now, updatedAt: now, ttlMs }, null, 2), 'utf-8');
      await handle.close();
      return true;
    } catch {
      try {
        const raw = await readFile(path, 'utf-8');
        const lock = JSON.parse(raw) as { ownerId?: string; createdAt?: number; updatedAt?: number; ttlMs?: number };
        const updatedAt = lock?.updatedAt || lock?.createdAt || 0;
        const ttl = lock?.ttlMs ?? ttlMs;
        if (now - updatedAt > ttl) {
          await rm(path);
          return this.acquireIndexLock(assistantId, ownerId, ttlMs, retryDepth + 1);
        }
      } catch {
        if (retryDepth < INDEX_LOCK_RETRIES) {
          try {
            await rm(path);
            return this.acquireIndexLock(assistantId, ownerId, ttlMs, retryDepth + 1);
          } catch {
            return false;
          }
        }
      }
    }

    return false;
  }

  private async releaseIndexLock(assistantId: string, ownerId: string): Promise<void> {
    const path = this.getIndexLockPath(assistantId);
    try {
      const raw = await readFile(path, 'utf-8');
      const lock = JSON.parse(raw) as { ownerId?: string };
      if (lock?.ownerId === ownerId) {
        await rm(path);
      }
    } catch {
      // Ignore missing lock
    }
  }

  private async withIndexLock<T>(
    assistantId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const ownerId = generateId();
    const locked = await this.acquireIndexLock(assistantId, ownerId);
    if (!locked) {
      throw new Error('Inbox index is locked');
    }
    try {
      return await fn();
    } finally {
      await this.releaseIndexLock(assistantId, ownerId);
    }
  }

  private getIndexPath(assistantId: string): string {
    return join(this.getAssistantPath(assistantId), 'index.json');
  }

  private getMessagePath(assistantId: string, messageId: string): string {
    this.validateSafeId(messageId, 'messageId');
    return join(this.getAssistantPath(assistantId), 'messages', `${messageId}.json`);
  }

  private getThreadPath(assistantId: string, threadId: string): string {
    this.validateSafeId(threadId, 'threadId');
    return join(this.getAssistantPath(assistantId), 'threads', `${threadId}.json`);
  }

  private getRegistryPath(): string {
    return join(this.basePath, 'registry.json');
  }

  // ============================================
  // Assistant Registry Operations
  // ============================================

  /**
   * Load the global assistant registry
   */
  async loadRegistry(): Promise<AssistantRegistry> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getRegistryPath());
      if (!(await file.exists())) {
        return { assistants: {} };
      }
      const data = await file.json() as Record<string, unknown>;
      // Backwards compatibility: migrate old { agents: {} } to { assistants: {} }
      if (data.agents && !data.assistants) {
        return { assistants: data.agents as Record<string, AssistantRegistryEntry> };
      }
      return { assistants: (data.assistants || {}) as Record<string, AssistantRegistryEntry> };
    } catch {
      return { assistants: {} };
    }
  }

  /**
   * Save the global assistant registry
   */
  async saveRegistry(registry: AssistantRegistry): Promise<void> {
    const runtime = getRuntime();
    await mkdir(this.basePath, { recursive: true });
    await runtime.write(this.getRegistryPath(), JSON.stringify(registry, null, 2));
  }

  /**
   * Register or update an assistant in the registry
   */
  async registerAssistant(assistantId: string, name: string): Promise<void> {
    const registry = await this.loadRegistry();
    registry.assistants[assistantId] = {
      name,
      lastSeen: new Date().toISOString(),
    };
    await this.saveRegistry(registry);
  }

  /**
   * Get assistant info by ID
   */
  async getAssistantById(assistantId: string): Promise<AssistantRegistryEntry | null> {
    const registry = await this.loadRegistry();
    return registry.assistants[assistantId] || null;
  }

  /**
   * Find assistant by name (case-insensitive)
   */
  async findAssistantByName(name: string): Promise<{ id: string; entry: AssistantRegistryEntry } | null> {
    const registry = await this.loadRegistry();
    const lowerName = name.toLowerCase();

    for (const [id, entry] of Object.entries(registry.assistants)) {
      if (entry.name.toLowerCase() === lowerName) {
        return { id, entry };
      }
    }

    return null;
  }

  /**
   * List all known assistants
   */
  async listAssistants(): Promise<Array<{ id: string; name: string; lastSeen: string }>> {
    const registry = await this.loadRegistry();
    return Object.entries(registry.assistants).map(([id, entry]) => ({
      id,
      name: entry.name,
      lastSeen: entry.lastSeen,
    }));
  }

  // ============================================
  // Inbox Index Operations
  // ============================================

  /**
   * Load inbox index for an assistant
   */
  async loadIndex(assistantId: string): Promise<InboxIndex> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getIndexPath(assistantId));
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
   * Save inbox index for an assistant
   */
  async saveIndex(assistantId: string, index: InboxIndex): Promise<void> {
    await this.ensureDirectories(assistantId);
    await atomicWriteFile(this.getIndexPath(assistantId), JSON.stringify(index, null, 2));
  }

  /**
   * Update index after message operations
   */
  private async rebuildIndexStats(assistantId: string, index: InboxIndex): Promise<void> {
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
  async saveMessage(message: AssistantMessage): Promise<void> {
    await this.ensureDirectories(message.toAssistantId);

    // Save full message
    const messagePath = this.getMessagePath(message.toAssistantId, message.id);
    await atomicWriteFile(messagePath, JSON.stringify(message, null, 2));

    await this.withIndexLock(message.toAssistantId, async () => {
      // Update index
      const index = await this.loadIndex(message.toAssistantId);

      const listItem: MessageListItem = {
        id: message.id,
        threadId: message.threadId,
        parentId: message.parentId,
        fromAssistantId: message.fromAssistantId,
        fromAssistantName: message.fromAssistantName,
        subject: message.subject,
        preview: message.body.slice(0, 100) + (message.body.length > 100 ? '...' : ''),
        priority: message.priority,
        status: message.status,
        createdAt: message.createdAt,
        replyCount: 0,
      };

      // Add to index (prepend for most recent first)
      index.messages.unshift(listItem);

      // Update reply count for parent only
      if (message.parentId) {
        const parent = index.messages.find((m) => m.id === message.parentId);
        if (parent) {
          parent.replyCount = (parent.replyCount || 0) + 1;
        }
      }

      await this.rebuildIndexStats(message.toAssistantId, index);
      await this.saveIndex(message.toAssistantId, index);

      // Update thread metadata
      await this.updateThread(message.toAssistantId, message);
    });
  }

  /**
   * Load a specific message
   */
  async loadMessage(assistantId: string, messageId: string): Promise<AssistantMessage | null> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getMessagePath(assistantId, messageId));
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
    assistantId: string,
    messageId: string,
    status: AssistantMessage['status'],
    timestamp?: string
  ): Promise<void> {
    const message = await this.loadMessage(assistantId, messageId);
    if (!message) return;

    const previousStatus = message.status;
    message.status = status;
    if (status === 'read' && timestamp) {
      message.readAt = timestamp;
    } else if (status === 'injected' && timestamp) {
      message.injectedAt = timestamp;
    }

    await atomicWriteFile(
      this.getMessagePath(assistantId, messageId),
      JSON.stringify(message, null, 2)
    );

    await this.withIndexLock(assistantId, async () => {
      // Update index
      const index = await this.loadIndex(assistantId);
      const indexItem = index.messages.find((m) => m.id === messageId);
      if (indexItem) {
        indexItem.status = status;
      }
      await this.rebuildIndexStats(assistantId, index);
      await this.saveIndex(assistantId, index);

      if (previousStatus !== status && message.threadId) {
        await this.updateThreadFromIndex(assistantId, message.threadId, index);
      }
    });
  }

  /**
   * Delete a message
   */
  async deleteMessage(assistantId: string, messageId: string): Promise<boolean> {
    const messagePath = this.getMessagePath(assistantId, messageId);
    try {
      const message = await this.loadMessage(assistantId, messageId);
      if (!message) return false;

      await rm(messagePath);

      await this.withIndexLock(assistantId, async () => {
        // Update index
        const index = await this.loadIndex(assistantId);
        if (message.parentId) {
          const parent = index.messages.find((m) => m.id === message.parentId);
          if (parent && parent.replyCount) {
            parent.replyCount = Math.max(0, parent.replyCount - 1);
          }
        }
        const msgIndex = index.messages.findIndex((m) => m.id === messageId);
        if (msgIndex >= 0) {
          index.messages.splice(msgIndex, 1);
          await this.rebuildIndexStats(assistantId, index);
          await this.saveIndex(assistantId, index);
          if (message.threadId) {
            await this.updateThreadFromIndex(assistantId, message.threadId, index);
          }
        }
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * List messages for an assistant
   */
  async listMessages(
    assistantId: string,
    options?: {
      limit?: number;
      unreadOnly?: boolean;
      threadId?: string;
      fromAssistantId?: string;
    }
  ): Promise<MessageListItem[]> {
    const index = await this.loadIndex(assistantId);
    let messages = [...index.messages];

    // Apply filters
    if (options?.unreadOnly) {
      messages = messages.filter((m) => m.status === 'unread' || m.status === 'injected');
    }
    if (options?.threadId) {
      messages = messages.filter((m) => m.threadId === options.threadId);
    }
    if (options?.fromAssistantId) {
      messages = messages.filter((m) => m.fromAssistantId === options.fromAssistantId);
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
  private async updateThread(assistantId: string, message: AssistantMessage): Promise<void> {
    const threadPath = this.getThreadPath(assistantId, message.threadId);
    let thread: MessageThread;

    try {
      const file = getRuntime().file(threadPath);
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
    const fromExists = thread.participants.some((p) => p.assistantId === message.fromAssistantId);
    if (!fromExists) {
      thread.participants.push({
        assistantId: message.fromAssistantId,
        assistantName: message.fromAssistantName,
      });
    }
    const toExists = thread.participants.some((p) => p.assistantId === message.toAssistantId);
    if (!toExists) {
      thread.participants.push({
        assistantId: message.toAssistantId,
        assistantName: message.toAssistantName,
      });
    }

    // Update counts
    thread.messageCount++;
    if (message.status === 'unread' || message.status === 'injected') {
      thread.unreadCount++;
    }

    // Update last message
    thread.lastMessage = {
      id: message.id,
      threadId: message.threadId,
      parentId: message.parentId,
      fromAssistantId: message.fromAssistantId,
      fromAssistantName: message.fromAssistantName,
      subject: message.subject,
      preview: message.body.slice(0, 100) + (message.body.length > 100 ? '...' : ''),
      priority: message.priority,
      status: message.status,
      createdAt: message.createdAt,
      replyCount: 0,
    };

    thread.updatedAt = message.createdAt;

    await atomicWriteFile(threadPath, JSON.stringify(thread, null, 2));
  }

  private async updateThreadFromIndex(
    assistantId: string,
    threadId: string,
    index: InboxIndex
  ): Promise<void> {
    const threadPath = this.getThreadPath(assistantId, threadId);
    let thread: MessageThread | null = null;
    try {
      const file = getRuntime().file(threadPath);
      if (await file.exists()) {
        thread = await file.json();
      }
    } catch {
      thread = null;
    }

    const threadMessages = index.messages.filter((m) => m.threadId === threadId);
    if (threadMessages.length === 0) {
      try {
        await rm(threadPath);
      } catch {
        // Ignore missing thread file
      }
      return;
    }

    if (!thread) {
      thread = {
        threadId,
        subject: threadMessages[0].subject,
        participants: [],
        messageCount: 0,
        unreadCount: 0,
        lastMessage: threadMessages[0],
        createdAt: threadMessages[threadMessages.length - 1].createdAt,
        updatedAt: threadMessages[0].createdAt,
      };
    }

    thread.messageCount = threadMessages.length;
    thread.unreadCount = threadMessages.filter((m) => m.status === 'unread' || m.status === 'injected').length;
    thread.lastMessage = threadMessages[0];
    thread.subject = thread.lastMessage.subject ?? thread.subject;
    thread.updatedAt = thread.lastMessage.createdAt;

    await atomicWriteFile(threadPath, JSON.stringify(thread, null, 2));
  }

  /**
   * Load thread metadata
   */
  async loadThread(assistantId: string, threadId: string): Promise<MessageThread | null> {
    try {
      const runtime = getRuntime();
      const file = runtime.file(this.getThreadPath(assistantId, threadId));
      if (!(await file.exists())) {
        return null;
      }
      return await file.json();
    } catch {
      return null;
    }
  }

  /**
   * List all threads for an assistant
   */
  async listThreads(assistantId: string): Promise<MessageThread[]> {
    const runtime = getRuntime();
    const assistantPath = this.getAssistantPath(assistantId);
    const threadsDir = join(assistantPath, 'threads');

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
  async loadThreadMessages(assistantId: string, threadId: string): Promise<AssistantMessage[]> {
    const index = await this.loadIndex(assistantId);
    const threadMessageIds = index.messages
      .filter((m) => m.threadId === threadId)
      .map((m) => m.id);

    const messages: AssistantMessage[] = [];
    for (const id of threadMessageIds) {
      const message = await this.loadMessage(assistantId, id);
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
  async cleanup(assistantId: string, maxAgeDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffTime = cutoffDate.getTime();

    const index = await this.loadIndex(assistantId);
    const toDelete: string[] = [];

    for (const msg of index.messages) {
      const msgTime = new Date(msg.createdAt).getTime();
      if (msgTime < cutoffTime) {
        toDelete.push(msg.id);
      }
    }

    for (const id of toDelete) {
      await this.deleteMessage(assistantId, id);
    }

    return toDelete.length;
  }

  /**
   * Enforce max messages limit
   */
  async enforceMaxMessages(assistantId: string, maxMessages: number): Promise<number> {
    const index = await this.loadIndex(assistantId);
    if (index.messages.length <= maxMessages) {
      return 0;
    }

    // Sort by date (oldest first)
    const sorted = [...index.messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const toDelete = sorted.slice(0, index.messages.length - maxMessages);

    for (const msg of toDelete) {
      await this.deleteMessage(assistantId, msg.id);
    }

    return toDelete.length;
  }
}

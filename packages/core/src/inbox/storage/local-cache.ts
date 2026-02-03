/**
 * Local filesystem cache for inbox emails
 * Stores parsed emails and attachments locally for fast access
 */

import { join, basename } from 'path';
import { mkdir, readFile, writeFile, rm, readdir, stat } from 'fs/promises';
import type { Email, EmailListItem } from '@hasna/assistants-shared';

/**
 * Pattern for safe IDs - only alphanumeric, hyphens, and underscores allowed
 */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that an ID is safe to use in filesystem paths.
 * Returns true if valid, false otherwise.
 */
function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && SAFE_ID_PATTERN.test(id);
}

/**
 * Validate and throw if ID is invalid
 */
function validateId(id: string, idType: string): void {
  if (!isValidId(id)) {
    throw new Error(
      `Invalid ${idType}: "${id}" contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }
}

/**
 * Sanitize a filename to prevent path traversal.
 * Extracts basename and removes any remaining path separators.
 */
function sanitizeFilename(filename: string): string {
  // Get the basename to strip directory components
  const base = basename(filename);
  // Remove any remaining path separators that might have been in the original filename
  return base.replace(/[/\\]/g, '_');
}

export interface LocalInboxCacheOptions {
  /** Agent ID for scoping */
  agentId: string;
  /** Base path for cache (default: ~/.assistants/inbox) */
  basePath: string;
}

export interface CacheIndex {
  /** List of cached emails */
  emails: CachedEmailEntry[];
  /** Last sync timestamp */
  lastSync?: string;
}

export interface CachedEmailEntry {
  /** Email ID */
  id: string;
  /** Message-ID header */
  messageId: string;
  /** Formatted from address */
  from: string;
  /** Subject */
  subject: string;
  /** Received date */
  date: string;
  /** Has attachments */
  hasAttachments: boolean;
  /** Read status */
  isRead: boolean;
  /** Cached timestamp */
  cachedAt: string;
}

/**
 * Local cache for inbox emails
 */
export class LocalInboxCache {
  private agentId: string;
  private basePath: string;
  private cacheDir: string;
  private index: CacheIndex | null = null;

  constructor(options: LocalInboxCacheOptions) {
    // Validate agentId to prevent path traversal
    validateId(options.agentId, 'agentId');
    this.agentId = options.agentId;
    this.basePath = options.basePath;
    this.cacheDir = join(this.basePath, this.agentId);
  }

  /**
   * Ensure cache directories exist
   */
  async ensureDirectories(): Promise<void> {
    await mkdir(join(this.cacheDir, 'emails'), { recursive: true });
    await mkdir(join(this.cacheDir, 'attachments'), { recursive: true });
  }

  /**
   * Load the cache index
   */
  async loadIndex(): Promise<CacheIndex> {
    if (this.index) return this.index;

    try {
      const indexPath = join(this.cacheDir, 'index.json');
      const content = await readFile(indexPath, 'utf-8');
      this.index = JSON.parse(content);
      return this.index!;
    } catch {
      this.index = { emails: [] };
      return this.index;
    }
  }

  /**
   * Save the cache index
   */
  async saveIndex(): Promise<void> {
    if (!this.index) return;

    await this.ensureDirectories();
    const indexPath = join(this.cacheDir, 'index.json');
    await writeFile(indexPath, JSON.stringify(this.index, null, 2));
  }

  /**
   * Save an email to the cache
   */
  async saveEmail(email: Email): Promise<void> {
    // Validate email ID to prevent path traversal
    validateId(email.id, 'emailId');
    await this.ensureDirectories();

    // Save email JSON
    const emailPath = join(this.cacheDir, 'emails', `${email.id}.json`);
    await writeFile(emailPath, JSON.stringify(email, null, 2));

    // Update index
    const index = await this.loadIndex();
    const existingIdx = index.emails.findIndex((e) => e.id === email.id);

    const entry: CachedEmailEntry = {
      id: email.id,
      messageId: email.messageId,
      from: email.from.name || email.from.address,
      subject: email.subject,
      date: email.date,
      hasAttachments: (email.attachments?.length || 0) > 0,
      isRead: false,
      cachedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      // Preserve read status
      entry.isRead = index.emails[existingIdx].isRead;
      index.emails[existingIdx] = entry;
    } else {
      index.emails.unshift(entry);
    }

    await this.saveIndex();
  }

  /**
   * Load an email from the cache
   */
  async loadEmail(id: string): Promise<Email | null> {
    // Validate ID to prevent path traversal
    if (!isValidId(id)) {
      return null;
    }
    try {
      const emailPath = join(this.cacheDir, 'emails', `${id}.json`);
      const content = await readFile(emailPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * List emails from the cache
   */
  async listEmails(options?: {
    limit?: number;
    unreadOnly?: boolean;
  }): Promise<EmailListItem[]> {
    const index = await this.loadIndex();

    let emails = index.emails;

    // Filter unread if requested
    if (options?.unreadOnly) {
      emails = emails.filter((e) => !e.isRead);
    }

    // Sort by date descending
    emails = [...emails].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Apply limit
    if (options?.limit && options.limit > 0) {
      emails = emails.slice(0, options.limit);
    }

    return emails.map((e) => ({
      id: e.id,
      messageId: e.messageId,
      from: e.from,
      subject: e.subject,
      date: e.date,
      hasAttachments: e.hasAttachments,
      isRead: e.isRead,
    }));
  }

  /**
   * Mark an email as read
   */
  async markRead(id: string): Promise<void> {
    const index = await this.loadIndex();
    const entry = index.emails.find((e) => e.id === id);
    if (entry) {
      entry.isRead = true;
      await this.saveIndex();
    }
  }

  /**
   * Mark an email as unread
   */
  async markUnread(id: string): Promise<void> {
    const index = await this.loadIndex();
    const entry = index.emails.find((e) => e.id === id);
    if (entry) {
      entry.isRead = false;
      await this.saveIndex();
    }
  }

  /**
   * Check if an email is cached
   */
  async hasCachedEmail(id: string): Promise<boolean> {
    const index = await this.loadIndex();
    return index.emails.some((e) => e.id === id);
  }

  /**
   * Get cached email IDs
   */
  async getCachedIds(): Promise<Set<string>> {
    const index = await this.loadIndex();
    return new Set(index.emails.map((e) => e.id));
  }

  /**
   * Save an attachment to local storage
   */
  async saveAttachment(
    emailId: string,
    filename: string,
    content: Buffer
  ): Promise<string> {
    // Validate emailId to prevent path traversal
    validateId(emailId, 'emailId');
    // Sanitize filename to prevent path traversal
    const safeFilename = sanitizeFilename(filename);
    if (!safeFilename) {
      throw new Error('Invalid attachment filename');
    }

    const attachmentDir = join(this.cacheDir, 'attachments', emailId);
    await mkdir(attachmentDir, { recursive: true });

    const attachmentPath = join(attachmentDir, safeFilename);
    await writeFile(attachmentPath, content);

    return attachmentPath;
  }

  /**
   * Get attachment path if downloaded
   */
  async getAttachmentPath(emailId: string, filename: string): Promise<string | null> {
    // Validate emailId to prevent path traversal
    if (!isValidId(emailId)) {
      return null;
    }
    // Sanitize filename to prevent path traversal
    const safeFilename = sanitizeFilename(filename);
    if (!safeFilename) {
      return null;
    }

    try {
      const attachmentPath = join(this.cacheDir, 'attachments', emailId, safeFilename);
      await stat(attachmentPath);
      return attachmentPath;
    } catch {
      return null;
    }
  }

  /**
   * Update last sync timestamp
   */
  async updateLastSync(): Promise<void> {
    const index = await this.loadIndex();
    index.lastSync = new Date().toISOString();
    await this.saveIndex();
  }

  /**
   * Get last sync timestamp
   */
  async getLastSync(): Promise<string | null> {
    const index = await this.loadIndex();
    return index.lastSync || null;
  }

  /**
   * Clean up old cached emails
   */
  async cleanup(maxAgeDays: number = 30): Promise<number> {
    const index = await this.loadIndex();
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const removed: string[] = [];

    // Find old emails (only consider entries with valid IDs)
    for (const entry of index.emails) {
      if (!isValidId(entry.id)) continue; // Skip invalid IDs
      const cachedAt = new Date(entry.cachedAt).getTime();
      if (cachedAt < cutoff) {
        removed.push(entry.id);
      }
    }

    // Remove from index and delete files
    for (const id of removed) {
      // Double-check ID is valid before rm (defense in depth)
      if (!isValidId(id)) continue;

      index.emails = index.emails.filter((e) => e.id !== id);

      // Delete email file
      try {
        await rm(join(this.cacheDir, 'emails', `${id}.json`));
      } catch {
        // Ignore
      }

      // Delete attachments directory
      try {
        await rm(join(this.cacheDir, 'attachments', id), { recursive: true });
      } catch {
        // Ignore
      }
    }

    if (removed.length > 0) {
      await this.saveIndex();
    }

    return removed.length;
  }

  /**
   * Get cache size in bytes
   */
  async getCacheSize(): Promise<number> {
    let totalSize = 0;

    try {
      const emailsDir = join(this.cacheDir, 'emails');
      const files = await readdir(emailsDir);
      for (const file of files) {
        const fileStat = await stat(join(emailsDir, file));
        totalSize += fileStat.size;
      }
    } catch {
      // Directory may not exist
    }

    try {
      const attachmentsDir = join(this.cacheDir, 'attachments');
      const dirs = await readdir(attachmentsDir);
      for (const dir of dirs) {
        const files = await readdir(join(attachmentsDir, dir));
        for (const file of files) {
          const fileStat = await stat(join(attachmentsDir, dir, file));
          totalSize += fileStat.size;
        }
      }
    } catch {
      // Directory may not exist
    }

    return totalSize;
  }

  /**
   * Clear the entire cache
   */
  async clear(): Promise<void> {
    try {
      await rm(this.cacheDir, { recursive: true });
    } catch {
      // Ignore
    }
    this.index = { emails: [] };
  }
}

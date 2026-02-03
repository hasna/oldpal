/**
 * Local filesystem cache for inbox emails
 * Stores parsed emails and attachments locally for fast access
 */

import { join, basename } from 'path';
import { mkdir, readFile, writeFile, rm, readdir, stat } from 'fs/promises';
import { createHash } from 'crypto';
import type { Email, EmailListItem } from '@hasna/assistants-shared';

/**
 * Pattern for agent IDs - strict alphanumeric, hyphens, and underscores only.
 * This is used for directory names where we control the ID format.
 */
const STRICT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Pattern for filesystem-safe filenames (after mapping).
 */
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that an agent ID is safe to use in filesystem paths.
 * Agent IDs should be tightly controlled (we generate them).
 */
function isValidAgentId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && STRICT_ID_PATTERN.test(id);
}

/**
 * Validate and throw if agent ID is invalid
 */
function validateAgentId(id: string): void {
  if (!isValidAgentId(id)) {
    throw new Error(
      `Invalid agentId: "${id}" contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }
}

/**
 * Map an email ID to a filesystem-safe filename.
 * Email IDs (Message-IDs) can contain characters like <, >, @, ., +, etc.
 * We create a deterministic, safe filename using base64url encoding.
 *
 * Short IDs that are already safe get passed through.
 * Longer or unsafe IDs get hashed + truncated original for readability.
 */
function emailIdToFilename(emailId: string): string {
  // If the ID is already safe and reasonably short, use it directly
  if (SAFE_FILENAME_PATTERN.test(emailId) && emailId.length <= 100) {
    return emailId;
  }

  // Create a deterministic hash of the full ID for uniqueness
  const hash = createHash('sha256').update(emailId).digest('base64url').slice(0, 16);

  // Extract a readable portion (alphanumeric only) for debuggability
  const readable = emailId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 20);

  // Combine: readable prefix + hash for uniqueness
  return readable ? `${readable}_${hash}` : hash;
}

/**
 * Check if a mapped filename is valid (defense in depth).
 */
function isValidMappedFilename(filename: string): boolean {
  return typeof filename === 'string' && filename.length > 0 && SAFE_FILENAME_PATTERN.test(filename);
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
  /** Email ID (original, may contain special characters) */
  id: string;
  /** Filesystem-safe filename derived from ID */
  filename: string;
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
    validateAgentId(options.agentId);
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
    // Map email ID to a filesystem-safe filename
    const filename = emailIdToFilename(email.id);
    if (!isValidMappedFilename(filename)) {
      throw new Error(`Failed to create safe filename for email ID: "${email.id}"`);
    }

    await this.ensureDirectories();

    // Save email JSON using the mapped filename
    const emailPath = join(this.cacheDir, 'emails', `${filename}.json`);
    await writeFile(emailPath, JSON.stringify(email, null, 2));

    // Update index (stores original ID and mapped filename)
    const index = await this.loadIndex();
    const existingIdx = index.emails.findIndex((e) => e.id === email.id);

    const entry: CachedEmailEntry = {
      id: email.id,
      filename,
      messageId: email.messageId,
      from: email.from.name || email.from.address,
      subject: email.subject,
      date: email.date,
      hasAttachments: (email.attachments?.length || 0) > 0,
      isRead: false,
      cachedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      // Preserve read status and use existing filename if available
      entry.isRead = index.emails[existingIdx].isRead;
      // Keep existing filename for consistency (in case mapping algorithm changes)
      entry.filename = index.emails[existingIdx].filename || filename;
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
    // Look up the filename from the index
    const index = await this.loadIndex();
    const entry = index.emails.find((e) => e.id === id);

    if (!entry) {
      return null;
    }

    // Use stored filename, or compute it for backwards compatibility
    const filename = entry.filename || emailIdToFilename(id);
    if (!isValidMappedFilename(filename)) {
      return null;
    }

    try {
      const emailPath = join(this.cacheDir, 'emails', `${filename}.json`);
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
    // Map emailId to a filesystem-safe directory name
    const emailFilename = emailIdToFilename(emailId);
    if (!isValidMappedFilename(emailFilename)) {
      throw new Error(`Failed to create safe directory name for email ID: "${emailId}"`);
    }

    // Sanitize attachment filename to prevent path traversal
    const safeFilename = sanitizeFilename(filename);
    if (!safeFilename) {
      throw new Error('Invalid attachment filename');
    }

    const attachmentDir = join(this.cacheDir, 'attachments', emailFilename);
    await mkdir(attachmentDir, { recursive: true });

    const attachmentPath = join(attachmentDir, safeFilename);
    await writeFile(attachmentPath, content);

    return attachmentPath;
  }

  /**
   * Get attachment path if downloaded
   */
  async getAttachmentPath(emailId: string, filename: string): Promise<string | null> {
    // Map emailId to a filesystem-safe directory name
    const emailFilename = emailIdToFilename(emailId);
    if (!isValidMappedFilename(emailFilename)) {
      return null;
    }

    // Sanitize filename to prevent path traversal
    const safeFilename = sanitizeFilename(filename);
    if (!safeFilename) {
      return null;
    }

    try {
      const attachmentPath = join(this.cacheDir, 'attachments', emailFilename, safeFilename);
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
    const toRemove: Array<{ id: string; filename: string }> = [];

    // Find old emails
    for (const entry of index.emails) {
      const cachedAt = new Date(entry.cachedAt).getTime();
      if (cachedAt < cutoff) {
        // Use stored filename or compute it for backwards compatibility
        const filename = entry.filename || emailIdToFilename(entry.id);
        if (isValidMappedFilename(filename)) {
          toRemove.push({ id: entry.id, filename });
        }
      }
    }

    // Remove from index and delete files
    for (const { id, filename } of toRemove) {
      index.emails = index.emails.filter((e) => e.id !== id);

      // Delete email file using the mapped filename
      try {
        await rm(join(this.cacheDir, 'emails', `${filename}.json`));
      } catch {
        // Ignore
      }

      // Delete attachments directory using the mapped filename
      try {
        await rm(join(this.cacheDir, 'attachments', filename), { recursive: true });
      } catch {
        // Ignore
      }
    }

    if (toRemove.length > 0) {
      await this.saveIndex();
    }

    return toRemove.length;
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

/** Exported for testing */
export const __test__ = {
  emailIdToFilename,
  isValidMappedFilename,
  isValidAgentId,
  sanitizeFilename,
};

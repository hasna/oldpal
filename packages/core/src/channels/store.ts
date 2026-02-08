/**
 * ChannelStore - SQLite storage for channels
 *
 * Manages channels, members, and messages in a shared SQLite database.
 * Follows the pattern from memory/global-memory.ts.
 */

import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { generateId } from '@hasna/assistants-shared';
import { getConfigDir } from '../config';
import { getRuntime } from '../runtime';
import type { DatabaseConnection } from '../runtime';
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelListItem,
  ChannelOperationResult,
  ChannelStatus,
  ChannelMemberRole,
} from './types';

/**
 * Generate a channel ID
 */
function generateChannelId(): string {
  return `ch_${generateId().slice(0, 12)}`;
}

/**
 * Generate a message ID
 */
function generateMessageId(): string {
  return `cmsg_${generateId().slice(0, 12)}`;
}

/**
 * ChannelStore manages all channel data in SQLite
 */
export class ChannelStore {
  private db: DatabaseConnection;

  constructor(dbPath?: string) {
    const baseDir = getConfigDir();
    const path = dbPath || join(baseDir, 'channels.db');
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = getRuntime();
    this.db = runtime.openDatabase(path);
    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_by TEXT NOT NULL,
        created_by_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id TEXT NOT NULL,
        assistant_id TEXT NOT NULL,
        assistant_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at TEXT NOT NULL,
        last_read_at TEXT,
        PRIMARY KEY (channel_id, assistant_id)
      );

      CREATE TABLE IF NOT EXISTS channel_messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_channel_messages_channel
        ON channel_messages(channel_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_channel_members_assistant
        ON channel_members(assistant_id);
    `);
  }

  // ============================================
  // Channel CRUD
  // ============================================

  /**
   * Create a new channel
   */
  createChannel(
    name: string,
    description: string | null,
    createdBy: string,
    createdByName: string
  ): ChannelOperationResult {
    const normalizedName = name.toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_-]/g, '-');

    // Check for duplicate name
    const existing = this.getChannelByName(normalizedName);
    if (existing) {
      return {
        success: false,
        message: `Channel #${normalizedName} already exists.`,
      };
    }

    const id = generateChannelId();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(
      `INSERT INTO channels (id, name, description, created_by, created_by_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
    );
    stmt.run(id, normalizedName, description, createdBy, createdByName, now, now);

    // Add creator as owner
    this.addMember(id, createdBy, createdByName, 'owner');

    return {
      success: true,
      message: `Channel #${normalizedName} created.`,
      channelId: id,
    };
  }

  /**
   * Get a channel by ID
   */
  getChannel(id: string): Channel | null {
    const stmt = this.db.prepare('SELECT * FROM channels WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToChannel(row) : null;
  }

  /**
   * Get a channel by name (case-insensitive)
   */
  getChannelByName(name: string): Channel | null {
    const normalizedName = name.toLowerCase().replace(/^#/, '');
    const stmt = this.db.prepare('SELECT * FROM channels WHERE name = ?');
    const row = stmt.get(normalizedName) as Record<string, unknown> | undefined;
    return row ? this.rowToChannel(row) : null;
  }

  /**
   * Resolve a channel by name or ID
   */
  resolveChannel(nameOrId: string): Channel | null {
    return this.getChannel(nameOrId) || this.getChannelByName(nameOrId);
  }

  /**
   * List channels with optional filters
   */
  listChannels(options?: {
    status?: ChannelStatus;
    assistantId?: string;
  }): ChannelListItem[] {
    let query: string;
    const params: unknown[] = [];

    if (options?.assistantId) {
      query = `
        SELECT c.*,
          (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count,
          (SELECT content FROM channel_messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_preview,
          (SELECT created_at FROM channel_messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
          (SELECT COUNT(*) FROM channel_messages WHERE channel_id = c.id
            AND created_at > COALESCE(
              (SELECT last_read_at FROM channel_members WHERE channel_id = c.id AND assistant_id = ?),
              '1970-01-01'
            )
          ) as unread_count
        FROM channels c
        INNER JOIN channel_members cm ON c.id = cm.channel_id AND cm.assistant_id = ?
      `;
      params.push(options.assistantId, options.assistantId);

      if (options?.status) {
        query += ' WHERE c.status = ?';
        params.push(options.status);
      }
    } else {
      query = `
        SELECT c.*,
          (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count,
          (SELECT content FROM channel_messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_preview,
          (SELECT created_at FROM channel_messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
          0 as unread_count
        FROM channels c
      `;

      if (options?.status) {
        query += ' WHERE c.status = ?';
        params.push(options.status);
      }
    }

    query += ' ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      status: String(row.status) as ChannelStatus,
      memberCount: Number(row.member_count),
      lastMessageAt: row.last_message_at ? String(row.last_message_at) : null,
      lastMessagePreview: row.last_message_preview
        ? String(row.last_message_preview).slice(0, 100)
        : null,
      unreadCount: Number(row.unread_count),
      createdAt: String(row.created_at),
    }));
  }

  /**
   * Archive a channel (soft delete)
   */
  archiveChannel(id: string): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'UPDATE channels SET status = ?, updated_at = ? WHERE id = ? AND status = ?'
    );
    const result = stmt.run('archived', now, id, 'active');
    return (result as { changes: number }).changes > 0;
  }

  // ============================================
  // Membership
  // ============================================

  /**
   * Add a member to a channel
   */
  addMember(
    channelId: string,
    assistantId: string,
    assistantName: string,
    role: ChannelMemberRole = 'member'
  ): boolean {
    try {
      const now = new Date().toISOString();
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO channel_members (channel_id, assistant_id, assistant_name, role, joined_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      const result = stmt.run(channelId, assistantId, assistantName, role, now);
      return (result as { changes: number }).changes > 0;
    } catch {
      return false;
    }
  }

  /**
   * Remove a member from a channel
   */
  removeMember(channelId: string, assistantId: string): boolean {
    const stmt = this.db.prepare(
      'DELETE FROM channel_members WHERE channel_id = ? AND assistant_id = ?'
    );
    const result = stmt.run(channelId, assistantId);
    return (result as { changes: number }).changes > 0;
  }

  /**
   * Get all members of a channel
   */
  getMembers(channelId: string): ChannelMember[] {
    const stmt = this.db.prepare(
      'SELECT * FROM channel_members WHERE channel_id = ? ORDER BY joined_at ASC'
    );
    const rows = stmt.all(channelId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToMember(row));
  }

  /**
   * Check if an assistant is a member of a channel
   */
  isMember(channelId: string, assistantId: string): boolean {
    const stmt = this.db.prepare(
      'SELECT 1 FROM channel_members WHERE channel_id = ? AND assistant_id = ?'
    );
    const row = stmt.get(channelId, assistantId);
    return !!row;
  }

  // ============================================
  // Messages
  // ============================================

  /**
   * Send a message to a channel
   */
  sendMessage(
    channelId: string,
    senderId: string,
    senderName: string,
    content: string
  ): string {
    const id = generateMessageId();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(
      `INSERT INTO channel_messages (id, channel_id, sender_id, sender_name, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    stmt.run(id, channelId, senderId, senderName, content, now);

    // Update channel updated_at
    this.db.prepare('UPDATE channels SET updated_at = ? WHERE id = ?').run(now, channelId);

    // Update sender's last_read_at (they've seen their own message)
    this.db.prepare(
      'UPDATE channel_members SET last_read_at = ? WHERE channel_id = ? AND assistant_id = ?'
    ).run(now, channelId, senderId);

    return id;
  }

  /**
   * Get messages from a channel
   */
  getMessages(
    channelId: string,
    options?: { limit?: number; before?: string }
  ): ChannelMessage[] {
    const limit = options?.limit || 50;

    let query = 'SELECT * FROM channel_messages WHERE channel_id = ?';
    const params: unknown[] = [channelId];

    if (options?.before) {
      query += ' AND created_at < ?';
      params.push(options.before);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];

    // Return in chronological order
    return rows.map((row) => this.rowToMessage(row)).reverse();
  }

  /**
   * Get unread messages for an assistant in a channel
   */
  getUnreadMessages(channelId: string, assistantId: string): ChannelMessage[] {
    const stmt = this.db.prepare(`
      SELECT m.* FROM channel_messages m
      INNER JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.assistant_id = ?
      WHERE m.channel_id = ?
        AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01')
        AND m.sender_id != ?
      ORDER BY m.created_at ASC
    `);
    const rows = stmt.all(assistantId, channelId, assistantId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToMessage(row));
  }

  /**
   * Get all unread messages across all channels for an assistant
   */
  getAllUnreadMessages(assistantId: string, maxTotal?: number): ChannelMessage[] {
    const limit = maxTotal || 50;
    const stmt = this.db.prepare(`
      SELECT m.* FROM channel_messages m
      INNER JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.assistant_id = ?
      WHERE m.created_at > COALESCE(cm.last_read_at, '1970-01-01')
        AND m.sender_id != ?
      ORDER BY m.created_at ASC
      LIMIT ?
    `);
    const rows = stmt.all(assistantId, assistantId, limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToMessage(row));
  }

  /**
   * Mark all messages as read for an assistant in a channel
   */
  markRead(channelId: string, assistantId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      'UPDATE channel_members SET last_read_at = ? WHERE channel_id = ? AND assistant_id = ?'
    ).run(now, channelId, assistantId);
  }

  /**
   * Get unread counts for all channels an assistant is in
   */
  getUnreadCounts(assistantId: string): Map<string, number> {
    const stmt = this.db.prepare(`
      SELECT cm.channel_id, COUNT(m.id) as unread_count
      FROM channel_members cm
      LEFT JOIN channel_messages m ON m.channel_id = cm.channel_id
        AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01')
        AND m.sender_id != ?
      WHERE cm.assistant_id = ?
      GROUP BY cm.channel_id
    `);
    const rows = stmt.all(assistantId, assistantId) as Record<string, unknown>[];

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(String(row.channel_id), Number(row.unread_count));
    }
    return counts;
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up old messages and archived channels
   */
  cleanup(maxAgeDays: number, maxMessagesPerChannel: number): number {
    let deleted = 0;

    // Delete old messages
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);
    const cutoffStr = cutoff.toISOString();

    const ageResult = this.db.prepare(
      'DELETE FROM channel_messages WHERE created_at < ?'
    ).run(cutoffStr);
    deleted += (ageResult as { changes: number }).changes;

    // Enforce per-channel message limit
    const channels = this.db.prepare('SELECT id FROM channels').all() as Record<string, unknown>[];
    for (const ch of channels) {
      const channelId = String(ch.id);
      const countResult = this.db.prepare(
        'SELECT COUNT(*) as cnt FROM channel_messages WHERE channel_id = ?'
      ).get(channelId) as Record<string, unknown>;
      const count = Number(countResult.cnt);

      if (count > maxMessagesPerChannel) {
        const excess = count - maxMessagesPerChannel;
        const trimResult = this.db.prepare(`
          DELETE FROM channel_messages WHERE id IN (
            SELECT id FROM channel_messages WHERE channel_id = ?
            ORDER BY created_at ASC LIMIT ?
          )
        `).run(channelId, excess);
        deleted += (trimResult as { changes: number }).changes;
      }
    }

    return deleted;
  }

  /**
   * Close the database connection
   */
  close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore close errors
    }
  }

  // ============================================
  // Row Mappers
  // ============================================

  private rowToChannel(row: Record<string, unknown>): Channel {
    return {
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      createdBy: String(row.created_by),
      createdByName: String(row.created_by_name),
      status: String(row.status) as ChannelStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private rowToMember(row: Record<string, unknown>): ChannelMember {
    return {
      channelId: String(row.channel_id),
      assistantId: String(row.assistant_id),
      assistantName: String(row.assistant_name),
      role: String(row.role) as ChannelMemberRole,
      joinedAt: String(row.joined_at),
      lastReadAt: row.last_read_at ? String(row.last_read_at) : null,
    };
  }

  private rowToMessage(row: Record<string, unknown>): ChannelMessage {
    return {
      id: String(row.id),
      channelId: String(row.channel_id),
      senderId: String(row.sender_id),
      senderName: String(row.sender_name),
      content: String(row.content),
      createdAt: String(row.created_at),
    };
  }
}

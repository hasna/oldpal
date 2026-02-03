import { join } from 'path';
import { getConfigDir } from '../config';
import { getRuntime } from '../runtime';
import type { DatabaseConnection } from '../runtime';

/**
 * Memory store - SQLite-based persistent storage
 */
export class MemoryStore {
  private db: DatabaseConnection;

  constructor(dbPath?: string, assistantId?: string | null) {
    const baseDir = getConfigDir();
    const path = dbPath || (assistantId
      ? join(baseDir, 'assistants', assistantId, 'memory.db')
      : join(baseDir, 'memory.db'));
    const runtime = getRuntime();
    this.db = runtime.openDatabase(path);
    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tool_calls TEXT,
        tool_results TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER
      )
    `);
  }

  /**
   * Store a key-value pair
   */
  set(key: string, value: unknown, ttlMs?: number): void {
    const now = Date.now();
    const ttl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : undefined;
    const expiresAt = ttl ? now + ttl : null;
    const valueStr = JSON.stringify(value) ?? 'null';

    this.db.prepare(
      `INSERT OR REPLACE INTO memory (key, value, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(key, valueStr, now, now, expiresAt);
  }

  /**
   * Get a value by key
   */
  get<T>(key: string): T | null {
    const row = this.db
      .query<{ value: string; expires_at: number | null }>(
        `SELECT value, expires_at FROM memory WHERE key = ?`
      )
      .get(key);

    if (!row) return null;

    // Check expiration
    if (row.expires_at && row.expires_at < Date.now()) {
      this.delete(key);
      return null;
    }

    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Delete a key
   */
  delete(key: string): void {
    this.db.prepare(`DELETE FROM memory WHERE key = ?`).run(key);
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Get all keys matching a pattern
   */
  keys(pattern?: string): string[] {
    const query = pattern
      ? `SELECT key FROM memory WHERE key LIKE ?`
      : `SELECT key FROM memory`;

    const rows = pattern
      ? this.db.query<{ key: string }>(query).all(pattern.replace(/\*/g, '%'))
      : this.db.query<{ key: string }>(query).all();

    return rows.map((r) => r.key);
  }

  /**
   * Clear all expired entries
   */
  clearExpired(): number {
    const result = this.db.prepare(
      `DELETE FROM memory WHERE expires_at IS NOT NULL AND expires_at < ?`
    ).run(Date.now());
    return result.changes;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

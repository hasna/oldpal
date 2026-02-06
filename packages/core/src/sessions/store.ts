/**
 * Session persistence store
 *
 * Persists session metadata to filesystem for recovery across restarts.
 * Storage: ~/.assistants/sessions/{id}.json
 */

import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';

/**
 * Persisted session data
 */
export interface PersistedSessionData {
  id: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  assistantId: string | null;
  label: string | null;
  status: 'active' | 'background' | 'closed';
}

/**
 * SessionStore - persists session metadata to filesystem
 */
export class SessionStore {
  private basePath: string;

  constructor(basePath?: string) {
    const envHome = process.env.HOME || process.env.USERPROFILE || homedir();
    this.basePath = basePath || join(envHome, '.assistants', 'sessions');
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getSessionPath(id: string): string {
    return join(this.basePath, `${id}.json`);
  }

  /**
   * Save session data
   */
  save(data: PersistedSessionData): void {
    try {
      const filePath = this.getSessionPath(data.id);
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
      // Non-critical - session persistence is best-effort
    }
  }

  /**
   * Load a single session
   */
  load(id: string): PersistedSessionData | null {
    try {
      const filePath = this.getSessionPath(id);
      if (!existsSync(filePath)) return null;
      return JSON.parse(readFileSync(filePath, 'utf-8')) as PersistedSessionData;
    } catch {
      return null;
    }
  }

  /**
   * List all persisted sessions
   */
  list(): PersistedSessionData[] {
    try {
      this.ensureDir();
      const files = readdirSync(this.basePath).filter((f) => f.endsWith('.json'));
      const sessions: PersistedSessionData[] = [];

      for (const file of files) {
        try {
          const data = JSON.parse(
            readFileSync(join(this.basePath, file), 'utf-8')
          ) as PersistedSessionData;
          sessions.push(data);
        } catch {
          // Skip corrupt files
        }
      }

      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /**
   * Delete a session file
   */
  delete(id: string): void {
    try {
      const filePath = this.getSessionPath(id);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * List sessions that were active (not closed) - for recovery
   */
  listRecoverable(): PersistedSessionData[] {
    return this.list().filter((s) => s.status !== 'closed');
  }

  /**
   * Mark all sessions as closed (e.g., on clean shutdown)
   */
  closeAll(): void {
    const sessions = this.list();
    for (const session of sessions) {
      session.status = 'closed';
      session.updatedAt = Date.now();
      this.save(session);
    }
  }
}

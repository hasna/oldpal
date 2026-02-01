import type { VerificationSession, VerificationResult } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';

/**
 * Storage for verification sessions
 * Allows users to view past verification results
 */
export class VerificationSessionStore {
  private basePath: string;
  private maxSessions: number;

  constructor(basePath: string, maxSessions: number = 100) {
    this.basePath = join(basePath, 'verifications');
    this.maxSessions = maxSessions;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Create a new verification session
   */
  create(
    parentSessionId: string,
    goals: string[],
    verificationResult: VerificationResult
  ): VerificationSession {
    const session: VerificationSession = {
      id: generateId(),
      parentSessionId,
      type: 'scope-verification',
      result: verificationResult.goalsMet ? 'pass' : 'fail',
      goals,
      reason: verificationResult.reason,
      suggestions: verificationResult.suggestions,
      verificationResult,
      createdAt: new Date().toISOString(),
    };

    this.save(session);
    this.pruneOldSessions();

    return session;
  }

  /**
   * Save a verification session
   */
  private save(session: VerificationSession): void {
    const filePath = join(this.basePath, `${session.id}.json`);
    writeFileSync(filePath, JSON.stringify(session, null, 2));
  }

  /**
   * Get a verification session by ID
   */
  get(id: string): VerificationSession | null {
    const filePath = join(this.basePath, `${id}.json`);
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as VerificationSession;
    } catch {
      return null;
    }
  }

  /**
   * Get all verification sessions for a parent session
   */
  getByParentSession(parentSessionId: string): VerificationSession[] {
    const sessions: VerificationSession[] = [];
    const files = this.listFiles();

    for (const file of files) {
      try {
        const content = readFileSync(join(this.basePath, file), 'utf-8');
        const session = JSON.parse(content) as VerificationSession;
        if (session.parentSessionId === parentSessionId) {
          sessions.push(session);
        }
      } catch {
        continue;
      }
    }

    return sessions.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * List recent verification sessions
   */
  listRecent(limit: number = 10): VerificationSession[] {
    const sessions: VerificationSession[] = [];
    const files = this.listFiles();

    for (const file of files) {
      try {
        const content = readFileSync(join(this.basePath, file), 'utf-8');
        const session = JSON.parse(content) as VerificationSession;
        sessions.push(session);
      } catch {
        continue;
      }
    }

    return sessions
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /**
   * Update a session's result (e.g., when force-continue is used)
   */
  updateResult(id: string, result: 'pass' | 'fail' | 'force-continue'): void {
    const session = this.get(id);
    if (!session) return;

    session.result = result;
    this.save(session);
  }

  /**
   * List all session files
   */
  private listFiles(): string[] {
    if (!existsSync(this.basePath)) {
      return [];
    }

    return readdirSync(this.basePath).filter((f) => f.endsWith('.json'));
  }

  /**
   * Prune old sessions to maintain max count
   */
  private pruneOldSessions(): void {
    const files = this.listFiles();
    if (files.length <= this.maxSessions) {
      return;
    }

    // Get all sessions with timestamps
    const sessions: { file: string; timestamp: number }[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(join(this.basePath, file), 'utf-8');
        const session = JSON.parse(content) as VerificationSession;
        sessions.push({
          file,
          timestamp: new Date(session.createdAt).getTime(),
        });
      } catch {
        continue;
      }
    }

    // Sort by timestamp (oldest first) and remove excess
    sessions.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = sessions.slice(0, sessions.length - this.maxSessions);

    for (const item of toRemove) {
      try {
        const { unlinkSync } = require('fs');
        unlinkSync(join(this.basePath, item.file));
      } catch {
        continue;
      }
    }
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    const files = this.listFiles();
    for (const file of files) {
      try {
        const { unlinkSync } = require('fs');
        unlinkSync(join(this.basePath, file));
      } catch {
        continue;
      }
    }
  }
}

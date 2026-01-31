import { existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

/**
 * Logger that writes to ~/.oldpal/logs/
 */
export class Logger {
  private logDir: string;
  private logFile: string;
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.logDir = join(getConfigDir(), 'logs');
    this.ensureDir(this.logDir);

    const date = new Date().toISOString().split('T')[0];
    this.logFile = join(this.logDir, `${date}.log`);
  }

  private ensureDir(dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private write(level: LogLevel, message: string, data?: unknown) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };

    const line = JSON.stringify({
      ...entry,
      sessionId: this.sessionId,
    }) + '\n';

    try {
      appendFileSync(this.logFile, line);
    } catch {
      // Ignore write errors
    }
  }

  debug(message: string, data?: unknown) {
    this.write('debug', message, data);
  }

  info(message: string, data?: unknown) {
    this.write('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.write('warn', message, data);
  }

  error(message: string, data?: unknown) {
    this.write('error', message, data);
  }
}

/**
 * Session storage - saves conversations to ~/.oldpal/sessions/
 */
export class SessionStorage {
  private sessionsDir: string;
  private sessionFile: string;
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.sessionsDir = join(getConfigDir(), 'sessions');
    this.ensureDir(this.sessionsDir);
    this.sessionFile = join(this.sessionsDir, `${sessionId}.json`);
  }

  private ensureDir(dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  save(data: {
    messages: unknown[];
    startedAt: string;
    updatedAt: string;
    cwd: string;
  }) {
    try {
      Bun.write(this.sessionFile, JSON.stringify(data, null, 2));
    } catch {
      // Ignore write errors
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Load session data from file
   */
  load(): SessionData | null {
    try {
      if (!existsSync(this.sessionFile)) return null;
      return JSON.parse(readFileSync(this.sessionFile, 'utf-8')) as SessionData;
    } catch {
      return null;
    }
  }

  /**
   * List all saved sessions
   */
  static listSessions(): SavedSessionInfo[] {
    const sessionsDir = join(getConfigDir(), 'sessions');
    if (!existsSync(sessionsDir)) return [];

    const sessions: SavedSessionInfo[] = [];
    const files = readdirSync(sessionsDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const filePath = join(sessionsDir, file);
        const stat = Bun.file(filePath);
        const content = JSON.parse(readFileSync(filePath, 'utf-8')) as SessionData;
        sessions.push({
          id: file.replace('.json', ''),
          cwd: content.cwd,
          startedAt: content.startedAt,
          updatedAt: content.updatedAt,
          messageCount: content.messages?.length || 0,
        });
      } catch {
        // Skip invalid files
      }
    }

    // Sort by updatedAt descending (most recent first)
    return sessions.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Get the most recent session
   */
  static getLatestSession(): SavedSessionInfo | null {
    const sessions = SessionStorage.listSessions();
    return sessions[0] || null;
  }

  /**
   * Load a session by ID
   */
  static loadSession(sessionId: string): SessionData | null {
    const sessionsDir = join(getConfigDir(), 'sessions');
    const sessionFile = join(sessionsDir, `${sessionId}.json`);

    try {
      if (!existsSync(sessionFile)) return null;
      return JSON.parse(readFileSync(sessionFile, 'utf-8')) as SessionData;
    } catch {
      return null;
    }
  }
}

/**
 * Session data structure
 */
export interface SessionData {
  messages: unknown[];
  startedAt: string;
  updatedAt: string;
  cwd: string;
}

/**
 * Saved session info (lightweight, for listing)
 */
export interface SavedSessionInfo {
  id: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * Initialize .oldpal directory structure
 */
export function initOldpalDir(): void {
  const baseDir = getConfigDir();
  const dirs = [
    baseDir,
    join(baseDir, 'sessions'),
    join(baseDir, 'logs'),
    join(baseDir, 'skills'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

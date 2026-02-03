import { existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync, writeFileSync } from 'fs';
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
 * Logger that writes to ~/.assistants/logs/
 */
export class Logger {
  private logDir: string;
  private logFile: string;
  private sessionId: string;

  constructor(sessionId: string, basePath?: string) {
    this.sessionId = sessionId;
    this.logDir = join(basePath || getConfigDir(), 'logs');
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
 * Session storage - saves conversations to ~/.assistants/assistants/{id}/sessions/
 */
export class SessionStorage {
  private sessionsDir: string;
  private sessionFile: string;
  private sessionId: string;

  constructor(sessionId: string, basePath?: string, assistantId?: string | null) {
    this.sessionId = sessionId;
    const root = basePath || getConfigDir();
    this.sessionsDir = assistantId
      ? join(root, 'assistants', assistantId, 'sessions')
      : join(root, 'sessions');
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
      writeFileSync(this.sessionFile, JSON.stringify(data, null, 2));
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

  private static getActiveAssistantId(): string | null {
    try {
      const activePath = join(getConfigDir(), 'active.json');
      if (!existsSync(activePath)) return null;
      const raw = readFileSync(activePath, 'utf-8');
      const data = JSON.parse(raw) as { id?: string };
      return data.id || null;
    } catch {
      return null;
    }
  }

  private static resolveSessionsDir(assistantId?: string | null): string {
    const root = getConfigDir();
    const resolvedId = assistantId ?? SessionStorage.getActiveAssistantId();
    if (resolvedId) {
      const assistantDir = join(root, 'assistants', resolvedId, 'sessions');
      if (existsSync(assistantDir)) {
        return assistantDir;
      }
    }
    return join(root, 'sessions');
  }

  /**
   * List all saved sessions
   */
  static listSessions(assistantId?: string | null): SavedSessionInfo[] {
    const sessionsDir = SessionStorage.resolveSessionsDir(assistantId);
    if (!existsSync(sessionsDir)) return [];

    const sessions: SavedSessionInfo[] = [];
    const files = readdirSync(sessionsDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const filePath = join(sessionsDir, file);
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
  static getLatestSession(assistantId?: string | null): SavedSessionInfo | null {
    const sessions = SessionStorage.listSessions(assistantId);
    return sessions[0] || null;
  }

  /**
   * Load a session by ID
   */
  static loadSession(sessionId: string, assistantId?: string | null): SessionData | null {
    const sessionsDir = SessionStorage.resolveSessionsDir(assistantId);
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
 * Initialize .assistants directory structure
 */
export function initAssistantsDir(): void {
  const baseDir = getConfigDir();
  const dirs = [
    baseDir,
    join(baseDir, 'logs'),
    join(baseDir, 'assistants'),
    join(baseDir, 'shared', 'skills'),
    join(baseDir, 'commands'),
    join(baseDir, 'temp'),
    join(baseDir, 'heartbeats'),
    join(baseDir, 'state'),
    join(baseDir, 'energy'),
    join(baseDir, 'migration'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

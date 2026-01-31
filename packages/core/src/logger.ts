import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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
    this.logDir = join(homedir(), '.oldpal', 'logs');
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
    this.sessionsDir = join(homedir(), '.oldpal', 'sessions');
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
}

/**
 * Initialize .oldpal directory structure
 */
export function initOldpalDir(): void {
  const baseDir = join(homedir(), '.oldpal');
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

import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { getConfigDir } from '../config';
import type { SecurityEvent, Severity } from './types';

export class SecurityLogger {
  private events: SecurityEvent[] = [];
  private logFile: string;

  constructor(logFile?: string) {
    this.logFile = logFile ?? join(getConfigDir(), 'security.log');
  }

  setLogFile(path: string): void {
    this.logFile = path;
  }

  log(event: Omit<SecurityEvent, 'timestamp'>): void {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.events.push(fullEvent);

    if (event.severity === 'critical' || event.severity === 'high') {
      console.warn(`[SECURITY] ${event.eventType}: ${event.details.reason}`);
    }

    void this.persist(fullEvent);
  }

  getEvents(filter?: Partial<SecurityEvent>): SecurityEvent[] {
    return this.events.filter((event) => {
      if (filter?.eventType && event.eventType !== filter.eventType) return false;
      if (filter?.severity && event.severity !== filter.severity) return false;
      if (filter?.sessionId && event.sessionId !== filter.sessionId) return false;
      return true;
    });
  }

  clear(): void {
    this.events = [];
  }

  private async persist(event: SecurityEvent): Promise<void> {
    try {
      await mkdir(dirname(this.logFile), { recursive: true });
      await appendFile(this.logFile, `${JSON.stringify(event)}\n`);
    } catch {
      // Ignore persistence errors.
    }
  }
}

let sharedLogger: SecurityLogger | null = null;

export function getSecurityLogger(): SecurityLogger {
  if (!sharedLogger) {
    sharedLogger = new SecurityLogger();
  }
  return sharedLogger;
}

export function setSecurityLogger(logger: SecurityLogger): void {
  sharedLogger = logger;
}

export function severityFromString(value?: string): Severity | undefined {
  if (!value) return undefined;
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return undefined;
}

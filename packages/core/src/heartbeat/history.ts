import { dirname, join } from 'path';
import { mkdirSync, existsSync, readdirSync } from 'fs';
import { appendFile, readFile } from 'fs/promises';
import { getConfigDir } from '../config';
import type { Heartbeat } from './types';

export type HeartbeatHistoryOrder = 'asc' | 'desc';

function applySessionPlaceholder(path: string, sessionId: string): string {
  if (path.includes('{sessionId}')) {
    return path.replace('{sessionId}', sessionId);
  }
  return path;
}

export function resolveHeartbeatPersistPath(sessionId: string, persistPath?: string): string {
  if (persistPath) {
    return applySessionPlaceholder(persistPath, sessionId);
  }
  return join(getConfigDir(), 'heartbeats', `${sessionId}.json`);
}

export function resolveHeartbeatHistoryPath(sessionId: string, historyPath?: string): string {
  if (historyPath) {
    return applySessionPlaceholder(historyPath, sessionId);
  }
  return join(getConfigDir(), 'heartbeats', 'runs', `${sessionId}.jsonl`);
}

export function listHeartbeatHistorySessions(baseDir?: string): string[] {
  const dir = baseDir ?? join(getConfigDir(), 'heartbeats', 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => file.replace(/\.jsonl$/, ''));
}

export async function appendHeartbeatHistory(historyPath: string, heartbeat: Heartbeat): Promise<void> {
  try {
    mkdirSync(dirname(historyPath), { recursive: true });
    await appendFile(historyPath, `${JSON.stringify(heartbeat)}\n`, 'utf-8');
  } catch {
    // Ignore history persistence errors
  }
}

export async function readHeartbeatHistory(
  historyPath: string,
  options: { limit?: number; order?: HeartbeatHistoryOrder } = {}
): Promise<Heartbeat[]> {
  try {
    const content = await readFile(historyPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const parsed: Heartbeat[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as Heartbeat);
      } catch {
        // Ignore malformed lines
      }
    }
    const order = options.order ?? 'desc';
    const ordered = order === 'desc' ? parsed.reverse() : parsed;
    if (options.limit && options.limit > 0) {
      return ordered.slice(0, options.limit);
    }
    return ordered;
  } catch {
    return [];
  }
}

export async function readHeartbeatHistoryBySession(
  sessionId: string,
  options: { historyPath?: string; limit?: number; order?: HeartbeatHistoryOrder } = {}
): Promise<Heartbeat[]> {
  const historyPath = resolveHeartbeatHistoryPath(sessionId, options.historyPath);
  return readHeartbeatHistory(historyPath, { limit: options.limit, order: options.order });
}

export async function readLatestHeartbeat(
  persistPath: string,
  historyPath?: string
): Promise<Heartbeat | null> {
  if (historyPath) {
    const history = await readHeartbeatHistory(historyPath, { limit: 1, order: 'desc' });
    if (history.length > 0) return history[0];
  }
  try {
    const content = await readFile(persistPath, 'utf-8');
    return JSON.parse(content) as Heartbeat;
  } catch {
    return null;
  }
}

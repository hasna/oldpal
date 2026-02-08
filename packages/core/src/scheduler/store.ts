import { join } from 'path';
import { mkdir, readdir, readFile, unlink, open } from 'fs/promises';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import { getProjectConfigDir } from '../config';
import { atomicWriteFile } from '../utils/atomic-write';
import { getNextCronRun } from './cron';

export const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function schedulesDir(cwd: string): string {
  return join(getProjectConfigDir(cwd), 'schedules');
}

function locksDir(cwd: string): string {
  return join(schedulesDir(cwd), 'locks');
}

function isSafeId(id: string): boolean {
  return SAFE_ID_PATTERN.test(id);
}

function schedulePath(cwd: string, id: string): string | null {
  if (!isSafeId(id)) return null;
  return join(schedulesDir(cwd), `${id}.json`);
}

function lockPath(cwd: string, id: string): string {
  return join(locksDir(cwd), `${id}.lock.json`);
}

async function ensureDirs(cwd: string): Promise<void> {
  await mkdir(schedulesDir(cwd), { recursive: true });
  await mkdir(locksDir(cwd), { recursive: true });
}

export interface ListSchedulesOptions {
  sessionId?: string;
  global?: boolean;
}

export async function listSchedules(cwd: string, options?: ListSchedulesOptions): Promise<ScheduledCommand[]> {
  try {
    const dir = schedulesDir(cwd);
    const files = await readdir(dir);
    const schedules: ScheduledCommand[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(dir, file), 'utf-8');
        const parsed = JSON.parse(raw) as ScheduledCommand;
        if (parsed?.id) schedules.push(parsed);
      } catch {
        // Skip malformed schedule files
      }
    }

    // Filter by sessionId if provided and not showing global schedules
    if (options?.sessionId && !options?.global) {
      return schedules.filter(
        (s) => s.sessionId === options.sessionId || !s.sessionId
      );
    }

    return schedules;
  } catch {
    return [];
  }
}

export async function saveSchedule(cwd: string, schedule: ScheduledCommand): Promise<void> {
  await ensureDirs(cwd);
  const path = schedulePath(cwd, schedule.id);
  if (!path) {
    throw new Error(`Invalid schedule id: ${schedule.id}`);
  }
  await atomicWriteFile(path, JSON.stringify(schedule, null, 2));
}

export async function getSchedule(cwd: string, id: string): Promise<ScheduledCommand | null> {
  try {
    const path = schedulePath(cwd, id);
    if (!path) return null;
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as ScheduledCommand;
  } catch {
    return null;
  }
}

export async function deleteSchedule(cwd: string, id: string): Promise<boolean> {
  try {
    const path = schedulePath(cwd, id);
    if (!path) return false;
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

export function computeNextRun(schedule: ScheduledCommand, fromTime: number): number | undefined {
  const timezone = schedule.schedule.timezone;
  const validTimezone = timezone && isValidTimeZone(timezone) ? timezone : undefined;
  if (schedule.schedule.kind === 'once') {
    if (!schedule.schedule.at) return undefined;
    const next = parseScheduledTime(schedule.schedule.at, validTimezone);
    if (!next || next <= fromTime) return undefined;
    return next;
  }
  if (schedule.schedule.kind === 'cron') {
    if (!schedule.schedule.cron) return undefined;
    return getNextCronRun(schedule.schedule.cron, fromTime, validTimezone);
  }
  if (schedule.schedule.kind === 'random') {
    return computeRandomNextRun(schedule.schedule, fromTime);
  }
  if (schedule.schedule.kind === 'interval') {
    return computeIntervalNextRun(schedule.schedule, fromTime);
  }
  return undefined;
}

/**
 * Compute next run time for a random interval schedule.
 * Calculates a random delay between minInterval and maxInterval.
 */
function computeRandomNextRun(
  schedule: { minInterval?: number; maxInterval?: number; unit?: 'seconds' | 'minutes' | 'hours' },
  fromTime: number
): number | undefined {
  const { minInterval, maxInterval, unit = 'minutes' } = schedule;
  if (!minInterval || !maxInterval || minInterval <= 0 || maxInterval <= 0) {
    return undefined;
  }
  if (minInterval > maxInterval) {
    return undefined;
  }

  // Convert to milliseconds
  const multiplier = unit === 'seconds' ? 1000 : unit === 'hours' ? 3600000 : 60000;
  const minMs = minInterval * multiplier;
  const maxMs = maxInterval * multiplier;

  // Generate random delay within range
  const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

  return fromTime + randomDelay;
}

/**
 * Compute next run time for a fixed interval schedule.
 * Supports sub-minute intervals down to 1 second.
 */
function computeIntervalNextRun(
  schedule: { interval?: number; unit?: 'seconds' | 'minutes' | 'hours' },
  fromTime: number
): number | undefined {
  const { interval, unit = 'minutes' } = schedule;
  if (!interval || interval <= 0) {
    return undefined;
  }

  // Convert to milliseconds
  const multiplier = unit === 'seconds' ? 1000 : unit === 'hours' ? 3600000 : 60000;
  const intervalMs = interval * multiplier;

  return fromTime + intervalMs;
}

export async function getDueSchedules(cwd: string, nowTime: number): Promise<ScheduledCommand[]> {
  const schedules = await listSchedules(cwd);
  return schedules.filter((schedule) => {
    if (schedule.status !== 'active') return false;
    if (!schedule.nextRunAt) return false;
    if (!Number.isFinite(schedule.nextRunAt)) return false;
    return schedule.nextRunAt <= nowTime;
  });
}

export async function updateSchedule(
  cwd: string,
  id: string,
  updater: (schedule: ScheduledCommand) => ScheduledCommand
): Promise<ScheduledCommand | null> {
  try {
    const path = schedulePath(cwd, id);
    if (!path) return null;
    const raw = await readFile(path, 'utf-8');
    const schedule = JSON.parse(raw) as ScheduledCommand;
    const updated = updater(schedule);
    await saveSchedule(cwd, updated);
    return updated;
  } catch {
    return null;
  }
}

const MAX_LOCK_RETRIES = 2;

export async function acquireScheduleLock(
  cwd: string,
  id: string,
  ownerId: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
  retryDepth: number = 0
): Promise<boolean> {
  if (!isSafeId(id)) return false;
  if (retryDepth >= MAX_LOCK_RETRIES) return false;
  await ensureDirs(cwd);
  const path = lockPath(cwd, id);
  const now = Date.now();

  try {
    const handle = await open(path, 'wx');
    await handle.writeFile(JSON.stringify({ ownerId, createdAt: now, updatedAt: now, ttlMs }, null, 2), 'utf-8');
    await handle.close();
    return true;
  } catch {
    try {
      const raw = await readFile(path, 'utf-8');
      const lock = JSON.parse(raw) as { ownerId?: string; createdAt?: number; updatedAt?: number; ttlMs?: number };
      const updatedAt = lock?.updatedAt || lock?.createdAt || 0;
      const ttl = lock?.ttlMs ?? ttlMs;
      if (now - updatedAt > ttl) {
        await unlink(path);
        return acquireScheduleLock(cwd, id, ownerId, ttlMs, retryDepth + 1);
      }
    } catch {
      if (retryDepth < MAX_LOCK_RETRIES) {
        try {
          await unlink(path);
          return acquireScheduleLock(cwd, id, ownerId, ttlMs, retryDepth + 1);
        } catch {
          return false;
        }
      }
    }
  }

  return false;
}

export async function releaseScheduleLock(cwd: string, id: string, ownerId: string): Promise<void> {
  if (!isSafeId(id)) return;
  const path = lockPath(cwd, id);
  try {
    const raw = await readFile(path, 'utf-8');
    const lock = JSON.parse(raw) as { ownerId?: string };
    if (lock?.ownerId === ownerId) {
      await unlink(path);
    }
  } catch {
    // Ignore missing lock
  }
}

export async function refreshScheduleLock(cwd: string, id: string, ownerId: string): Promise<void> {
  if (!isSafeId(id)) return;
  const path = lockPath(cwd, id);
  try {
    const raw = await readFile(path, 'utf-8');
    const lock = JSON.parse(raw) as { ownerId?: string; createdAt?: number; updatedAt?: number; ttlMs?: number };
    if (lock?.ownerId === ownerId) {
      const updated = { ...lock, updatedAt: Date.now() };
      await atomicWriteFile(path, JSON.stringify(updated, null, 2));
    }
  } catch {
    // Ignore refresh errors
  }
}

export async function readSchedule(cwd: string, id: string): Promise<ScheduledCommand | null> {
  try {
    const path = schedulePath(cwd, id);
    if (!path) return null;
    const raw = await readFile(path, 'utf-8');
    const schedule = JSON.parse(raw) as ScheduledCommand;
    if (!schedule?.id) return null;
    return schedule;
  } catch {
    return null;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function parseScheduledTime(value: string, timeZone?: string): number | undefined {
  if (!value) return undefined;
  if (!timeZone || hasTimeZoneOffset(value)) {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : undefined;
  }

  if (!isValidTimeZone(timeZone)) return undefined;

  const parsed = parseDateTime(value);
  if (!parsed) return undefined;

  const utcGuess = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, parsed.second);
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  return utcGuess - offset;
}

function parseDateTime(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? '0');
  const minute = Number(match[5] ?? '0');
  const second = Number(match[6] ?? '0');
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null;
  }
  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 ||
    second < 0 || second > 59
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function hasTimeZoneOffset(value: string): boolean {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.get('year'));
  const month = Number(lookup.get('month'));
  const day = Number(lookup.get('day'));
  const hour = Number(lookup.get('hour'));
  const minute = Number(lookup.get('minute'));
  const second = Number(lookup.get('second'));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}

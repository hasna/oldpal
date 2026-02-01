import { join } from 'path';
import { mkdir, readdir, readFile, unlink, writeFile, open } from 'fs/promises';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import { getProjectConfigDir } from '../config';
import { getNextCronRun } from './cron';

export const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;

function schedulesDir(cwd: string): string {
  return join(getProjectConfigDir(cwd), 'schedules');
}

function locksDir(cwd: string): string {
  return join(schedulesDir(cwd), 'locks');
}

function schedulePath(cwd: string, id: string): string {
  return join(schedulesDir(cwd), `${id}.json`);
}

function lockPath(cwd: string, id: string): string {
  return join(locksDir(cwd), `${id}.lock.json`);
}

async function ensureDirs(cwd: string): Promise<void> {
  await mkdir(schedulesDir(cwd), { recursive: true });
  await mkdir(locksDir(cwd), { recursive: true });
}

export async function listSchedules(cwd: string): Promise<ScheduledCommand[]> {
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
    return schedules;
  } catch {
    return [];
  }
}

export async function saveSchedule(cwd: string, schedule: ScheduledCommand): Promise<void> {
  await ensureDirs(cwd);
  const path = schedulePath(cwd, schedule.id);
  await writeFile(path, JSON.stringify(schedule, null, 2), 'utf-8');
}

export async function deleteSchedule(cwd: string, id: string): Promise<boolean> {
  try {
    await unlink(schedulePath(cwd, id));
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
    return parseScheduledTime(schedule.schedule.at, validTimezone);
  }
  if (schedule.schedule.kind === 'cron') {
    if (!schedule.schedule.cron) return undefined;
    return getNextCronRun(schedule.schedule.cron, fromTime, validTimezone);
  }
  return undefined;
}

export async function getDueSchedules(cwd: string, nowTime: number): Promise<ScheduledCommand[]> {
  const schedules = await listSchedules(cwd);
  return schedules.filter((schedule) => {
    if (schedule.status !== 'active') return false;
    if (!schedule.nextRunAt) return false;
    return schedule.nextRunAt <= nowTime;
  });
}

export async function updateSchedule(
  cwd: string,
  id: string,
  updater: (schedule: ScheduledCommand) => ScheduledCommand
): Promise<ScheduledCommand | null> {
  try {
    const raw = await readFile(schedulePath(cwd, id), 'utf-8');
    const schedule = JSON.parse(raw) as ScheduledCommand;
    const updated = updater(schedule);
    await saveSchedule(cwd, updated);
    return updated;
  } catch {
    return null;
  }
}

export async function acquireScheduleLock(
  cwd: string,
  id: string,
  ownerId: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS
): Promise<boolean> {
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
        return acquireScheduleLock(cwd, id, ownerId, ttlMs);
      }
    } catch {
      // Ignore errors reading lock file
    }
  }

  return false;
}

export async function releaseScheduleLock(cwd: string, id: string, ownerId: string): Promise<void> {
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
  const path = lockPath(cwd, id);
  try {
    const raw = await readFile(path, 'utf-8');
    const lock = JSON.parse(raw) as { ownerId?: string; createdAt?: number; updatedAt?: number; ttlMs?: number };
    if (lock?.ownerId === ownerId) {
      const updated = { ...lock, updatedAt: Date.now() };
      await writeFile(path, JSON.stringify(updated, null, 2), 'utf-8');
    }
  } catch {
    // Ignore refresh errors
  }
}

export async function readSchedule(cwd: string, id: string): Promise<ScheduledCommand | null> {
  try {
    const raw = await readFile(schedulePath(cwd, id), 'utf-8');
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

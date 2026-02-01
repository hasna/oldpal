import { join } from 'path';
import { mkdir, readdir, readFile, unlink, writeFile, open } from 'fs/promises';
import type { ScheduledCommand } from '@oldpal/shared';
import { getProjectConfigDir } from '../config';
import { getNextCronRun } from './cron';

const LOCK_TTL_MS = 10 * 60 * 1000;

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
  if (schedule.schedule.kind === 'once') {
    if (!schedule.schedule.at) return undefined;
    const ts = Date.parse(schedule.schedule.at);
    return Number.isFinite(ts) ? ts : undefined;
  }
  if (schedule.schedule.kind === 'cron') {
    if (!schedule.schedule.cron) return undefined;
    return getNextCronRun(schedule.schedule.cron, fromTime);
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
  ttlMs: number = LOCK_TTL_MS
): Promise<boolean> {
  await ensureDirs(cwd);
  const path = lockPath(cwd, id);
  const now = Date.now();

  try {
    const handle = await open(path, 'wx');
    await handle.writeFile(JSON.stringify({ ownerId, createdAt: now }, null, 2), 'utf-8');
    await handle.close();
    return true;
  } catch {
    try {
      const raw = await readFile(path, 'utf-8');
      const lock = JSON.parse(raw) as { ownerId?: string; createdAt?: number };
      const createdAt = lock?.createdAt || 0;
      if (now - createdAt > ttlMs) {
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

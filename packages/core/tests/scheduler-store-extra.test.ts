import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import {
  acquireScheduleLock,
  computeNextRun,
  deleteSchedule,
  getDueSchedules,
  isValidTimeZone,
  listSchedules,
  readSchedule,
  refreshScheduleLock,
  releaseScheduleLock,
  saveSchedule,
  updateSchedule,
} from '../src/scheduler/store';

const buildSchedule = (overrides?: Partial<ScheduledCommand>): ScheduledCommand => ({
  id: 'sched-1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  createdBy: 'user',
  command: '/status',
  status: 'active',
  schedule: { kind: 'once', at: new Date(Date.now() + 60000).toISOString() },
  nextRunAt: undefined,
  ...overrides,
});

describe('scheduler store extras', () => {
  test('saveSchedule rejects invalid ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistants-sched-invalid-'));
    try {
      const schedule = buildSchedule({ id: '../bad' });
      await expect(saveSchedule(dir, schedule)).rejects.toThrow('Invalid schedule id');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('listSchedules skips malformed files and deleteSchedule handles missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistants-sched-list-'));
    try {
      const schedulesDir = join(dir, '.assistants', 'schedules');
      await mkdir(schedulesDir, { recursive: true });
      await writeFile(join(schedulesDir, 'bad.json'), '{ nope', 'utf-8').catch(() => {});
      const schedule = buildSchedule({ id: 'sched-1' });
      schedule.nextRunAt = computeNextRun(schedule, Date.now());
      await saveSchedule(dir, schedule);
      const list = await listSchedules(dir);
      expect(list.length).toBe(1);

      const deleted = await deleteSchedule(dir, 'missing');
      expect(deleted).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('getDueSchedules filters by status and time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistants-sched-due-'));
    try {
      const due = buildSchedule({ id: 'due', nextRunAt: Date.now() - 1000 });
      const later = buildSchedule({ id: 'later', nextRunAt: Date.now() + 100000 });
      const paused = buildSchedule({ id: 'paused', status: 'paused', nextRunAt: Date.now() - 1000 });
      await saveSchedule(dir, due);
      await saveSchedule(dir, later);
      await saveSchedule(dir, paused);
      const result = await getDueSchedules(dir, Date.now());
      expect(result.map((item) => item.id)).toEqual(['due']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('updateSchedule reads and writes updates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistants-sched-update-'));
    try {
      const schedule = buildSchedule({ id: 'sched-1' });
      await saveSchedule(dir, schedule);
      const updated = await updateSchedule(dir, 'sched-1', (current) => ({
        ...current,
        status: 'paused',
      }));
      expect(updated?.status).toBe('paused');

      const missing = await updateSchedule(dir, 'missing', (current) => current);
      expect(missing).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('lock lifecycle: acquire, refresh, release', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistants-sched-locks-'));
    try {
      const acquired = await acquireScheduleLock(dir, 'sched-1', 'owner-1', 1000);
      expect(acquired).toBe(true);

      const lockPath = join(dir, '.assistants', 'schedules', 'locks', 'sched-1.lock.json');
      const before = JSON.parse(await readFile(lockPath, 'utf-8')) as { updatedAt?: number };
      await refreshScheduleLock(dir, 'sched-1', 'owner-1');
      const after = JSON.parse(await readFile(lockPath, 'utf-8')) as { updatedAt?: number };
      expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt || 0);

      await releaseScheduleLock(dir, 'sched-1', 'wrong-owner');
      const stillThere = await readFile(lockPath, 'utf-8');
      expect(stillThere).toContain('owner-1');

      await releaseScheduleLock(dir, 'sched-1', 'owner-1');
      const readAfter = await readFile(lockPath, 'utf-8').catch(() => null);
      expect(readAfter).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('acquireScheduleLock replaces expired lock', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistants-sched-expired-'));
    try {
      const lockDir = join(dir, '.assistants', 'schedules', 'locks');
      await mkdir(lockDir, { recursive: true });
      const lockPath = join(lockDir, 'sched-1.lock.json');
      await writeFile(lockPath, JSON.stringify({ ownerId: 'old', updatedAt: Date.now() - 2000, ttlMs: 1000 }), 'utf-8');

      const acquired = await acquireScheduleLock(dir, 'sched-1', 'owner-1', 1000);
      expect(acquired).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('computeNextRun handles once and cron schedules', () => {
    const now = new Date('2026-02-01T00:00:00Z').getTime();
    const once = buildSchedule({
      schedule: { kind: 'once', at: '2026-02-01T01:00:00Z' },
      nextRunAt: undefined,
    });
    expect(computeNextRun(once, now)).toBeGreaterThan(now);

    const cron = buildSchedule({
      schedule: { kind: 'cron', cron: '*/5 * * * *' },
      nextRunAt: undefined,
    });
    expect(computeNextRun(cron, now)).toBeGreaterThan(now);
  });

  test('readSchedule returns null for invalid ids and invalid time zones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assistants-sched-read-'));
    try {
      const schedule = buildSchedule({ id: 'sched-1' });
      await saveSchedule(dir, schedule);
      const loaded = await readSchedule(dir, 'sched-1');
      expect(loaded?.id).toBe('sched-1');

      expect(await readSchedule(dir, '../bad')).toBeNull();
      expect(isValidTimeZone('UTC')).toBe(true);
      expect(isValidTimeZone('Not/AZone')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

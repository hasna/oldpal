import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import { computeNextRun, listSchedules, saveSchedule } from '../src/scheduler/store';
import { getNextCronRun } from '../src/scheduler/cron';

describe('Scheduler', () => {
  test('compute next run for cron', () => {
    const now = new Date(2026, 1, 1, 0, 0, 0).getTime();
    const next = getNextCronRun('*/5 * * * *', now);
    expect(next).toBeDefined();
    if (next) {
      const diffMins = Math.round((next - now) / 60000);
      expect(diffMins).toBe(5);
    }
  });

  test('save and list schedules', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-sched-'));
    try {
      const schedule: ScheduledCommand = {
        id: 'sched-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'user',
        command: '/status',
        status: 'active',
        schedule: { kind: 'once', at: new Date(Date.now() + 60000).toISOString() },
        nextRunAt: undefined,
      };
      schedule.nextRunAt = computeNextRun(schedule, Date.now());
      await saveSchedule(tempDir, schedule);
      const list = await listSchedules(tempDir);
      expect(list.length).toBe(1);
      expect(list[0].command).toBe('/status');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

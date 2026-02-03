import { describe, expect, test } from 'bun:test';
import { withTempDir } from './fixtures/helpers';
import {
  saveSchedule,
  readSchedule,
  computeNextRun,
} from '../src/scheduler/store';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import { SchedulerTool } from '../src/tools/scheduler';

const buildSchedule = (overrides?: Partial<ScheduledCommand>): ScheduledCommand => ({
  id: 'sched-1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  createdBy: 'agent',
  command: 'cmd',
  status: 'active',
  schedule: { kind: 'once', at: new Date(Date.now() + 60000).toISOString() },
  nextRunAt: undefined,
  ...overrides,
});

describe('SchedulerTool', () => {
  test('list action formats output', async () => {
    await withTempDir(async (dir) => {
      const first = buildSchedule({ id: 'a', nextRunAt: Date.now() + 1000, command: 'cmd-a' });
      const second = buildSchedule({ id: 'b', nextRunAt: Date.now() + 2000, command: 'cmd-b' });
      await saveSchedule(dir, second);
      await saveSchedule(dir, first);

      const output = await SchedulerTool.executor({ action: 'list', cwd: dir });
      const firstIndex = output.indexOf('- a [active] cmd-a');
      const secondIndex = output.indexOf('- b [active] cmd-b');
      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(secondIndex).toBeGreaterThan(firstIndex);
    });
  });

  test('create action validates inputs', async () => {
    expect(await SchedulerTool.executor({ action: 'create', command: '' })).toBe('Error: command is required.');
    expect(await SchedulerTool.executor({ action: 'create', command: 'cmd' })).toBe('Error: provide either at (ISO time) or cron.');

    expect(
      await SchedulerTool.executor({ action: 'create', command: 'cmd', at: '2026-02-01T10:00:00', timezone: 'Bad/Zone' })
    ).toBe('Error: invalid timezone "Bad/Zone".');

    const past = new Date(Date.now() - 1000).toISOString();
    const error = await SchedulerTool.executor({ action: 'create', command: 'cmd', at: past });
    expect(error).toBe('Error: unable to compute next run for schedule.');
  });

  test('create action saves schedule', async () => {
    await withTempDir(async (dir) => {
      const future = new Date(Date.now() + 60000).toISOString();
      const output = await SchedulerTool.executor({ action: 'create', command: 'cmd', at: future, cwd: dir });
      const match = output.match(/\(([^)]+)\)/);
      expect(match).not.toBeNull();
      const id = match?.[1];
      const saved = id ? await readSchedule(dir, id) : null;
      expect(saved?.command).toBe('cmd');
    });
  });

  test('delete action handles missing id and not found', async () => {
    expect(await SchedulerTool.executor({ action: 'delete', id: '' })).toBe('Error: id is required.');
    await withTempDir(async (dir) => {
      const response = await SchedulerTool.executor({ action: 'delete', id: 'missing', cwd: dir });
      expect(response).toBe('Schedule missing not found.');
    });
  });

  test('pause/resume actions update schedule', async () => {
    await withTempDir(async (dir) => {
      const schedule = buildSchedule({ id: 'sched-1' });
      schedule.nextRunAt = computeNextRun(schedule, Date.now());
      await saveSchedule(dir, schedule);

      const paused = await SchedulerTool.executor({ action: 'pause', id: 'sched-1', cwd: dir });
      expect(paused).toBe('Paused schedule sched-1.');
      const pausedSchedule = await readSchedule(dir, 'sched-1');
      expect(pausedSchedule?.status).toBe('paused');

      const resumed = await SchedulerTool.executor({ action: 'resume', id: 'sched-1', cwd: dir });
      expect(resumed).toBe('Resumed schedule sched-1.');
      const resumedSchedule = await readSchedule(dir, 'sched-1');
      expect(resumedSchedule?.status).toBe('active');
    });
  });

  test('unknown action returns error', async () => {
    const output = await SchedulerTool.executor({ action: 'unknown' });
    expect(output).toBe('Error: unknown action "unknown".');
  });
});

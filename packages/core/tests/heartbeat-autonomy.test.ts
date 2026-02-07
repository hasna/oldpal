import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Conventions ─────────────────────────────────────────────────────

import {
  HEARTBEAT_KEYS,
  heartbeatScheduleId,
  WATCHDOG_SCHEDULE_ID,
  DEFAULT_MAX_SLEEP_MS,
  MIN_SLEEP_MS,
  DEFAULT_SLEEP_MS,
  DEFAULT_WATCHDOG_INTERVAL_MS,
} from '../src/heartbeat/conventions';

describe('heartbeat/conventions', () => {
  test('HEARTBEAT_KEYS contains expected keys', () => {
    expect(HEARTBEAT_KEYS.LAST).toBe('agent.heartbeat.last');
    expect(HEARTBEAT_KEYS.NEXT).toBe('agent.heartbeat.next');
    expect(HEARTBEAT_KEYS.INTENTION).toBe('agent.heartbeat.intention');
    expect(HEARTBEAT_KEYS.GOALS).toBe('agent.goals');
    expect(HEARTBEAT_KEYS.LAST_ACTIONS).toBe('agent.state.lastActions');
    expect(HEARTBEAT_KEYS.PENDING).toBe('agent.state.pending');
  });

  test('heartbeatScheduleId returns deterministic ID', () => {
    expect(heartbeatScheduleId('abc-123')).toBe('heartbeat-abc-123');
    expect(heartbeatScheduleId('session-x')).toBe('heartbeat-session-x');
  });

  test('WATCHDOG_SCHEDULE_ID is fixed', () => {
    expect(WATCHDOG_SCHEDULE_ID).toBe('watchdog-main');
  });

  test('timing defaults are sensible', () => {
    expect(DEFAULT_MAX_SLEEP_MS).toBe(30 * 60 * 1000);
    expect(MIN_SLEEP_MS).toBe(30 * 1000);
    expect(DEFAULT_SLEEP_MS).toBe(10 * 60 * 1000);
    expect(DEFAULT_WATCHDOG_INTERVAL_MS).toBe(60 * 60 * 1000);
    // Min < Default < Max
    expect(MIN_SLEEP_MS).toBeLessThan(DEFAULT_SLEEP_MS);
    expect(DEFAULT_SLEEP_MS).toBeLessThanOrEqual(DEFAULT_MAX_SLEEP_MS);
  });
});

// ── Auto-schedule hook ──────────────────────────────────────────────

import { createAutoScheduleHeartbeatHook } from '../src/heartbeat/auto-schedule-hook';
import { getSchedule, saveSchedule, deleteSchedule } from '../src/scheduler/store';
import type { NativeHookContext, HookInput, ScheduledCommand } from '@hasna/assistants-shared';

function makeHookInput(sessionId: string): HookInput {
  return {
    session_id: sessionId,
    hook_event_name: 'Stop',
    cwd: '/tmp', // overridden by context
  };
}

function makeContext(cwd: string, sessionId: string, autonomous: boolean): NativeHookContext {
  return {
    sessionId,
    cwd,
    messages: [],
    config: {
      heartbeat: {
        autonomous,
        maxSleepMs: DEFAULT_MAX_SLEEP_MS,
      },
    },
  };
}

describe('heartbeat/auto-schedule-hook', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-hb-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('creates hook with correct properties', () => {
    const hook = createAutoScheduleHeartbeatHook();
    expect(hook.id).toBe('auto-schedule-heartbeat');
    expect(hook.event).toBe('Stop');
    expect(hook.priority).toBe(100);
    expect(typeof hook.handler).toBe('function');
  });

  test('returns null when autonomous is false', async () => {
    const hook = createAutoScheduleHeartbeatHook();
    const result = await hook.handler(
      makeHookInput('sess-1'),
      makeContext(tempDir, 'sess-1', false),
    );
    expect(result).toBeNull();
  });

  test('creates schedule when none exists', async () => {
    const hook = createAutoScheduleHeartbeatHook();
    const sessionId = 'sess-create';
    await hook.handler(
      makeHookInput(sessionId),
      makeContext(tempDir, sessionId, true),
    );

    const scheduleId = heartbeatScheduleId(sessionId);
    const schedule = await getSchedule(tempDir, scheduleId);
    expect(schedule).not.toBeNull();
    expect(schedule!.status).toBe('active');
    expect(schedule!.actionType).toBe('message');
    expect(schedule!.message).toBe('/main-loop');
    expect(schedule!.schedule.kind).toBe('once');
    expect(schedule!.sessionId).toBe(sessionId);
  });

  test('does not overwrite existing active schedule', async () => {
    const sessionId = 'sess-existing';
    const scheduleId = heartbeatScheduleId(sessionId);
    const originalTime = Date.now() + 999999;

    // Pre-create an active schedule
    await saveSchedule(tempDir, {
      id: scheduleId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'assistant',
      sessionId,
      actionType: 'message',
      command: '/main-loop',
      message: '/main-loop',
      status: 'active',
      schedule: { kind: 'once', at: new Date(originalTime).toISOString() },
      nextRunAt: originalTime,
    });

    // Run hook
    const hook = createAutoScheduleHeartbeatHook();
    await hook.handler(
      makeHookInput(sessionId),
      makeContext(tempDir, sessionId, true),
    );

    // Verify original schedule is unchanged
    const schedule = await getSchedule(tempDir, scheduleId);
    expect(schedule!.nextRunAt).toBe(originalTime);
  });

  test('creates schedule when existing is completed', async () => {
    const sessionId = 'sess-completed';
    const scheduleId = heartbeatScheduleId(sessionId);

    // Pre-create a completed schedule
    await saveSchedule(tempDir, {
      id: scheduleId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'assistant',
      sessionId,
      actionType: 'message',
      command: '/main-loop',
      status: 'completed',
      schedule: { kind: 'once' },
    });

    // Run hook — should overwrite since status is not active
    const hook = createAutoScheduleHeartbeatHook();
    await hook.handler(
      makeHookInput(sessionId),
      makeContext(tempDir, sessionId, true),
    );

    const schedule = await getSchedule(tempDir, scheduleId);
    expect(schedule!.status).toBe('active');
  });
});

// ── Watchdog ────────────────────────────────────────────────────────

import { ensureWatchdogSchedule } from '../src/heartbeat/watchdog';

describe('heartbeat/watchdog', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-wd-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('creates watchdog schedule if none exists', async () => {
    await ensureWatchdogSchedule(tempDir, 'sess-w1');
    const schedule = await getSchedule(tempDir, WATCHDOG_SCHEDULE_ID);
    expect(schedule).not.toBeNull();
    expect(schedule!.status).toBe('active');
    expect(schedule!.schedule.kind).toBe('interval');
    expect(schedule!.message).toBe('/watchdog');
    expect(schedule!.actionType).toBe('message');
  });

  test('respects custom interval', async () => {
    const customMs = 5 * 60 * 1000; // 5 min
    await ensureWatchdogSchedule(tempDir, 'sess-w2', customMs);
    const schedule = await getSchedule(tempDir, WATCHDOG_SCHEDULE_ID);
    expect(schedule!.schedule.interval).toBe(300); // 5 min in seconds
  });

  test('does not overwrite existing active watchdog', async () => {
    // Create first watchdog
    await ensureWatchdogSchedule(tempDir, 'sess-w3', 120_000);
    const first = await getSchedule(tempDir, WATCHDOG_SCHEDULE_ID);
    const firstCreatedAt = first!.createdAt;

    // Wait a tick and try again
    await new Promise((r) => setTimeout(r, 10));
    await ensureWatchdogSchedule(tempDir, 'sess-w3', 300_000);

    // Should still be original
    const second = await getSchedule(tempDir, WATCHDOG_SCHEDULE_ID);
    expect(second!.createdAt).toBe(firstCreatedAt);
  });
});

// ── Install skills ──────────────────────────────────────────────────

import { installHeartbeatSkills } from '../src/heartbeat/install-skills';

describe('heartbeat/install-skills', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-skills-'));
    originalHome = process.env.ASSISTANTS_DIR;
    process.env.ASSISTANTS_DIR = tempDir;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.ASSISTANTS_DIR;
    } else {
      process.env.ASSISTANTS_DIR = originalHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  test('installs both skills on first run', async () => {
    const installed = await installHeartbeatSkills();
    expect(installed).toContain('main-loop');
    expect(installed).toContain('watchdog');

    // Verify files exist
    const mainLoopPath = join(tempDir, 'shared', 'skills', 'skill-main-loop', 'SKILL.md');
    const watchdogPath = join(tempDir, 'shared', 'skills', 'skill-watchdog', 'SKILL.md');

    const mainContent = await readFile(mainLoopPath, 'utf-8');
    expect(mainContent).toContain('name: main-loop');
    expect(mainContent).toContain('Autonomous Heartbeat');

    const watchdogContent = await readFile(watchdogPath, 'utf-8');
    expect(watchdogContent).toContain('name: watchdog');
    expect(watchdogContent).toContain('Watchdog Check');
  });

  test('skips already installed skills', async () => {
    // First install
    await installHeartbeatSkills();
    // Second install should return empty
    const installed = await installHeartbeatSkills();
    expect(installed).toEqual([]);
  });
});

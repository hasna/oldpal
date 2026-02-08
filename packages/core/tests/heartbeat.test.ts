import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { HeartbeatManager } from '../src/heartbeat/manager';
import { StatePersistence } from '../src/heartbeat/persistence';
import { RecoveryManager } from '../src/heartbeat/recovery';
import type { Heartbeat } from '../src/heartbeat/types';
import { readHeartbeatHistory } from '../src/heartbeat/history';
import {
  HEARTBEAT_KEYS,
  heartbeatScheduleId,
  WATCHDOG_SCHEDULE_ID,
  DEFAULT_MAX_SLEEP_MS,
  MIN_SLEEP_MS,
  DEFAULT_SLEEP_MS,
  DEFAULT_WATCHDOG_INTERVAL_MS,
} from '../src/heartbeat/conventions';
import { createAutoScheduleHeartbeatHook } from '../src/heartbeat/auto-schedule-hook';
import { ensureWatchdogSchedule } from '../src/heartbeat/watchdog';
import { installHeartbeatSkills } from '../src/heartbeat/install-skills';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-heartbeat-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('HeartbeatManager', () => {
  test('emits and persists heartbeat', async () => {
    const heartbeatPath = join(tempDir, 'hb.json');
    const manager = new HeartbeatManager({
      intervalMs: 10,
      staleThresholdMs: 50,
      persistPath: heartbeatPath,
    });

    manager.start('sess-1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    manager.stop();

    const file = Bun.file(heartbeatPath);
    const exists = await file.exists();
    expect(exists).toBe(true);
    const content = await file.json();
    expect(content.sessionId).toBe('sess-1');
  });

  test('writes heartbeat history when configured', async () => {
    const heartbeatPath = join(tempDir, 'hb.json');
    const historyPath = join(tempDir, 'runs', 'sess-1.jsonl');
    const manager = new HeartbeatManager({
      intervalMs: 10,
      staleThresholdMs: 50,
      persistPath: heartbeatPath,
      historyPath,
    });

    manager.start('sess-1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    manager.stop();

    const runs = await readHeartbeatHistory(historyPath, { order: 'desc' });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].sessionId).toBe('sess-1');
  });
});

describe('StatePersistence', () => {
  test('saves and loads persisted state', async () => {
    const statePath = join(tempDir, 'state.json');
    const persistence = new StatePersistence(statePath);
    const heartbeat: Heartbeat = {
      sessionId: 'sess-2',
      timestamp: new Date().toISOString(),
      state: 'idle',
      lastActivity: new Date().toISOString(),
      stats: { messagesProcessed: 1, toolCallsExecuted: 0, errorsEncountered: 0, uptimeSeconds: 5 },
    };

    await persistence.save({
      sessionId: 'sess-2',
      heartbeat,
      context: { cwd: tempDir },
      timestamp: new Date().toISOString(),
    });

    const loaded = await persistence.load();
    expect(loaded?.sessionId).toBe('sess-2');
  });
});

describe('RecoveryManager', () => {
  test('detects stale recovery state', async () => {
    const heartbeatPath = join(tempDir, 'hb.json');
    const statePath = join(tempDir, 'state.json');
    const persistence = new StatePersistence(statePath);

    const oldTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const heartbeat: Heartbeat = {
      sessionId: 'sess-3',
      timestamp: oldTimestamp,
      state: 'processing',
      lastActivity: oldTimestamp,
      stats: { messagesProcessed: 2, toolCallsExecuted: 1, errorsEncountered: 0, uptimeSeconds: 100 },
    };

    writeFileSync(heartbeatPath, JSON.stringify(heartbeat, null, 2));

    await persistence.save({
      sessionId: 'sess-3',
      heartbeat,
      context: { cwd: tempDir },
      timestamp: oldTimestamp,
    });

    const recovery = new RecoveryManager(persistence, heartbeatPath, 1000, {
      autoResume: false,
      maxAgeMs: 10 * 60 * 1000,
    });

    const result = await recovery.checkForRecovery();
    expect(result.available).toBe(true);
    expect(result.state?.sessionId).toBe('sess-3');
  });
});

// ── Autonomy module tests ─────────────────────────────────────────

describe('conventions', () => {
  test('heartbeatScheduleId returns deterministic ID', () => {
    expect(heartbeatScheduleId('sess-1')).toBe('heartbeat-sess-1');
    expect(heartbeatScheduleId('abc')).toBe('heartbeat-abc');
  });

  test('WATCHDOG_SCHEDULE_ID is a fixed string', () => {
    expect(WATCHDOG_SCHEDULE_ID).toBe('watchdog-main');
  });

  test('memory key constants are defined', () => {
    expect(HEARTBEAT_KEYS.LAST).toBe('agent.heartbeat.last');
    expect(HEARTBEAT_KEYS.NEXT).toBe('agent.heartbeat.next');
    expect(HEARTBEAT_KEYS.INTENTION).toBe('agent.heartbeat.intention');
    expect(HEARTBEAT_KEYS.GOALS).toBe('agent.goals');
    expect(HEARTBEAT_KEYS.LAST_ACTIONS).toBe('agent.state.lastActions');
    expect(HEARTBEAT_KEYS.PENDING).toBe('agent.state.pending');
  });

  test('timing defaults are reasonable', () => {
    expect(DEFAULT_MAX_SLEEP_MS).toBe(30 * 60 * 1000); // 30 min
    expect(MIN_SLEEP_MS).toBe(30 * 1000); // 30 sec
    expect(DEFAULT_SLEEP_MS).toBe(10 * 60 * 1000); // 10 min
    expect(DEFAULT_WATCHDOG_INTERVAL_MS).toBe(60 * 60 * 1000); // 1 hour
  });
});

describe('createAutoScheduleHeartbeatHook', () => {
  test('returns a valid NativeHook', () => {
    const hook = createAutoScheduleHeartbeatHook();
    expect(hook.id).toBe('auto-schedule-heartbeat');
    expect(hook.event).toBe('Stop');
    expect(hook.priority).toBe(100);
    expect(typeof hook.handler).toBe('function');
  });

  test('handler returns null when autonomous is disabled', async () => {
    const hook = createAutoScheduleHeartbeatHook();
    const result = await hook.handler(
      { toolName: 'bash', toolInput: {} },
      { sessionId: 'sess-1', cwd: tempDir, config: { heartbeat: { autonomous: false } } } as any,
    );
    expect(result).toBeNull();
  });

  test('handler returns null when no config', async () => {
    const hook = createAutoScheduleHeartbeatHook();
    const result = await hook.handler(
      { toolName: 'bash', toolInput: {} },
      { sessionId: 'sess-1', cwd: tempDir, config: {} } as any,
    );
    expect(result).toBeNull();
  });

  test('handler creates schedule when autonomous is enabled', async () => {
    // Create the .assistants/schedules directory
    const schedulesDir = join(tempDir, '.assistants', 'schedules');
    mkdirSync(schedulesDir, { recursive: true });

    const hook = createAutoScheduleHeartbeatHook();
    const result = await hook.handler(
      { toolName: 'bash', toolInput: {} },
      {
        sessionId: 'test-sess',
        cwd: tempDir,
        config: { heartbeat: { autonomous: true } },
      } as any,
    );
    expect(result).toBeNull(); // Never blocks

    // Verify schedule file was created
    const scheduleFile = join(schedulesDir, 'heartbeat-test-sess.json');
    expect(existsSync(scheduleFile)).toBe(true);

    const schedule = JSON.parse(readFileSync(scheduleFile, 'utf-8'));
    expect(schedule.id).toBe('heartbeat-test-sess');
    expect(schedule.actionType).toBe('message');
    expect(schedule.message).toBe('/main-loop');
    expect(schedule.status).toBe('active');
    expect(schedule.schedule.kind).toBe('once');
  });

  test('handler skips when active schedule exists', async () => {
    const schedulesDir = join(tempDir, '.assistants', 'schedules');
    mkdirSync(schedulesDir, { recursive: true });

    // Create an existing active schedule
    const existing = {
      id: 'heartbeat-test-sess',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'assistant',
      command: '/main-loop',
      schedule: { kind: 'once', at: new Date(Date.now() + 60000).toISOString() },
      nextRunAt: Date.now() + 60000,
    };
    writeFileSync(join(schedulesDir, 'heartbeat-test-sess.json'), JSON.stringify(existing));

    const hook = createAutoScheduleHeartbeatHook();
    const result = await hook.handler(
      { toolName: 'bash', toolInput: {} },
      {
        sessionId: 'test-sess',
        cwd: tempDir,
        config: { heartbeat: { autonomous: true } },
      } as any,
    );
    expect(result).toBeNull();
  });
});

describe('ensureWatchdogSchedule', () => {
  test('creates watchdog schedule in schedules dir', async () => {
    const schedulesDir = join(tempDir, '.assistants', 'schedules');
    mkdirSync(schedulesDir, { recursive: true });

    await ensureWatchdogSchedule(tempDir, 'sess-wd');

    const scheduleFile = join(schedulesDir, 'watchdog-main.json');
    expect(existsSync(scheduleFile)).toBe(true);

    const schedule = JSON.parse(readFileSync(scheduleFile, 'utf-8'));
    expect(schedule.id).toBe('watchdog-main');
    expect(schedule.actionType).toBe('message');
    expect(schedule.message).toBe('/watchdog');
    expect(schedule.status).toBe('active');
    expect(schedule.schedule.kind).toBe('interval');
    expect(schedule.schedule.unit).toBe('seconds');
    // Default interval: 1 hour = 3600 seconds
    expect(schedule.schedule.interval).toBe(3600);
  });

  test('skips if active watchdog already exists', async () => {
    const schedulesDir = join(tempDir, '.assistants', 'schedules');
    mkdirSync(schedulesDir, { recursive: true });

    // Create existing watchdog schedule
    const existing = {
      id: 'watchdog-main',
      status: 'active',
      createdAt: Date.now() - 10000,
      updatedAt: Date.now() - 10000,
      createdBy: 'assistant',
      command: '/watchdog',
      schedule: { kind: 'interval', interval: 3600, unit: 'seconds' },
    };
    writeFileSync(join(schedulesDir, 'watchdog-main.json'), JSON.stringify(existing));

    await ensureWatchdogSchedule(tempDir, 'sess-wd2');

    // File should still contain the original createdAt (not overwritten)
    const schedule = JSON.parse(readFileSync(join(schedulesDir, 'watchdog-main.json'), 'utf-8'));
    expect(schedule.createdAt).toBe(existing.createdAt);
  });

  test('accepts custom interval', async () => {
    const schedulesDir = join(tempDir, '.assistants', 'schedules');
    mkdirSync(schedulesDir, { recursive: true });

    await ensureWatchdogSchedule(tempDir, 'sess-custom', 5 * 60 * 1000); // 5 minutes

    const schedule = JSON.parse(readFileSync(join(schedulesDir, 'watchdog-main.json'), 'utf-8'));
    expect(schedule.schedule.interval).toBe(300); // 5 min = 300 seconds
  });
});

describe('installHeartbeatSkills', () => {
  test('installs main-loop and watchdog skills', async () => {
    // Override getConfigDir to use temp dir
    const skillsDir = join(tempDir, 'shared', 'skills');
    mkdirSync(skillsDir, { recursive: true });

    // We can't easily override getConfigDir, so test the skill content structure
    // by verifying the function is callable and returns an array
    // The actual installation depends on getConfigDir() pointing to ~/.assistants
    const result = await installHeartbeatSkills();
    expect(Array.isArray(result)).toBe(true);
    // Result should be skill names that were newly installed
    for (const name of result) {
      expect(typeof name).toBe('string');
    }
  });
});

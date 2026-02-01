import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { HeartbeatManager } from '../src/heartbeat/manager';
import { StatePersistence } from '../src/heartbeat/persistence';
import { RecoveryManager } from '../src/heartbeat/recovery';
import type { Heartbeat } from '../src/heartbeat/types';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'oldpal-heartbeat-'));
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

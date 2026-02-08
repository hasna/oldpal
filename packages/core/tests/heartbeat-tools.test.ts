import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ToolRegistry } from '../src/tools/registry';
import {
  createHeartbeatToolExecutors,
  registerHeartbeatTools,
} from '../src/tools/heartbeat';
import type { Heartbeat } from '../src/heartbeat/types';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-heartbeat-tools-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('heartbeat tools', () => {
  test('heartbeat_status returns state and runs', async () => {
    const sessionId = 'sess-tools';
    const historyDir = join(tempDir, 'heartbeats', 'runs');
    mkdirSync(historyDir, { recursive: true });
    const historyPath = join(historyDir, `${sessionId}.jsonl`);
    const run: Heartbeat = {
      sessionId,
      timestamp: new Date(Date.now() - 5000).toISOString(),
      state: 'idle',
      lastActivity: new Date(Date.now() - 2000).toISOString(),
      stats: { messagesProcessed: 2, toolCallsExecuted: 1, errorsEncountered: 0, uptimeSeconds: 5 },
    };
    writeFileSync(historyPath, `${JSON.stringify(run)}\n`);

    const executors = createHeartbeatToolExecutors({
      sessionId,
      getHeartbeatState: () => ({
        enabled: true,
        state: 'idle',
        lastActivity: run.lastActivity,
        uptimeSeconds: 5,
        isStale: false,
      }),
      getHeartbeatConfig: () => ({
        historyPath,
      }),
    });

    const result = JSON.parse(await executors.heartbeat_status({ includeRuns: true, limit: 5 }));
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe(sessionId);
    expect(result.runs.length).toBeGreaterThan(0);
    expect(result.state).toBe('idle');
  });

  test('heartbeat_runs returns run list', async () => {
    const sessionId = 'sess-runs';
    const historyDir = join(tempDir, 'heartbeats', 'runs');
    mkdirSync(historyDir, { recursive: true });
    const historyPath = join(historyDir, `${sessionId}.jsonl`);
    const run: Heartbeat = {
      sessionId,
      timestamp: new Date().toISOString(),
      state: 'processing',
      lastActivity: new Date().toISOString(),
      stats: { messagesProcessed: 0, toolCallsExecuted: 0, errorsEncountered: 0, uptimeSeconds: 1 },
    };
    writeFileSync(historyPath, `${JSON.stringify(run)}\n`);

    const executors = createHeartbeatToolExecutors({
      sessionId,
      getHeartbeatConfig: () => ({ historyPath }),
    });

    const result = JSON.parse(await executors.heartbeat_runs({ limit: 10 }));
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.runs[0].state).toBe('processing');
  });
});

describe('registerHeartbeatTools', () => {
  test('registers heartbeat tools', () => {
    const registry = new ToolRegistry();
    registerHeartbeatTools(registry, { sessionId: 'sess' });
    const names = registry.getTools().map((t) => t.name);
    expect(names).toContain('heartbeat_status');
    expect(names).toContain('heartbeat_runs');
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Logger, SessionStorage, initOldpalDir } from '../src/logger';

let tempDir: string;
let originalOldpalDir: string | undefined;

beforeEach(() => {
  originalOldpalDir = process.env.OLDPAL_DIR;
  tempDir = mkdtempSync(join(tmpdir(), 'oldpal-logger-'));
  process.env.OLDPAL_DIR = tempDir;
});

afterEach(() => {
  process.env.OLDPAL_DIR = originalOldpalDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Logger', () => {
  test('initOldpalDir creates base directories', () => {
    initOldpalDir();
    expect(existsSync(join(tempDir, 'logs'))).toBe(true);
    expect(existsSync(join(tempDir, 'sessions'))).toBe(true);
    expect(existsSync(join(tempDir, 'skills'))).toBe(true);
  });

  test('writes log entries to file', () => {
    const logger = new Logger('session-123');
    logger.info('hello', { ok: true });

    const date = new Date().toISOString().split('T')[0];
    const logPath = join(tempDir, 'logs', `${date}.log`);
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, 'utf-8').trim().split('\n').pop() || '';
    const entry = JSON.parse(content);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('hello');
    expect(entry.sessionId).toBe('session-123');
  });
});

describe('SessionStorage', () => {
  test('save and load round-trip', () => {
    const storage = new SessionStorage('sess');
    storage.save({
      messages: [{ id: '1' }],
      startedAt: 'start',
      updatedAt: 'end',
      cwd: '/tmp',
    });

    const loaded = storage.load();
    expect(loaded?.cwd).toBe('/tmp');
    expect(storage.getSessionId()).toBe('sess');
  });
});

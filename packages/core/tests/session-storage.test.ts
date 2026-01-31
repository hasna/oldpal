import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { SessionStorage } from '../src/logger';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;
let originalHome: string | undefined;
let originalOldpalDir: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  originalOldpalDir = process.env.OLDPAL_DIR;
  tempDir = await mkdtemp(join(tmpdir(), 'oldpal-sessions-'));
  process.env.OLDPAL_DIR = tempDir;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  process.env.OLDPAL_DIR = originalOldpalDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe('SessionStorage', () => {
  test('should save and load session data', () => {
    const storage = new SessionStorage('session-1');
    storage.save({
      messages: [{ role: 'user', content: 'hi' }],
      startedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z',
      cwd: '/tmp/project',
    });

    const loaded = storage.load();
    expect(loaded?.cwd).toBe('/tmp/project');
    expect(loaded?.messages.length).toBe(1);
  });

  test('should list and load latest session', () => {
    const storage1 = new SessionStorage('session-1');
    storage1.save({
      messages: [],
      startedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z',
      cwd: '/tmp/project1',
    });

    const storage2 = new SessionStorage('session-2');
    storage2.save({
      messages: [],
      startedAt: '2024-01-01T00:00:02.000Z',
      updatedAt: '2024-01-01T00:00:03.000Z',
      cwd: '/tmp/project2',
    });

    const sessions = SessionStorage.listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions[0].id).toBe('session-2');

    const latest = SessionStorage.getLatestSession();
    expect(latest?.id).toBe('session-2');

    const loaded = SessionStorage.loadSession('session-1');
    expect(loaded?.cwd).toBe('/tmp/project1');
  });
});

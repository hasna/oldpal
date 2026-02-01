import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureConfigDir, loadHooksConfig, loadSystemPrompt, loadConfig, getTempFolder, getConfigDir } from '../src/config';

let tempDir: string;
let originalOldpalDir: string | undefined;

beforeEach(() => {
  originalOldpalDir = process.env.OLDPAL_DIR;
  tempDir = mkdtempSync(join(tmpdir(), 'oldpal-config-'));
  process.env.OLDPAL_DIR = tempDir;
});

afterEach(() => {
  process.env.OLDPAL_DIR = originalOldpalDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('config helpers', () => {
  test('ensureConfigDir creates base directories', async () => {
    await ensureConfigDir('sess');
    expect(existsSync(join(tempDir, 'sessions'))).toBe(true);
    expect(existsSync(join(tempDir, 'skills'))).toBe(true);
    expect(existsSync(join(tempDir, 'temp'))).toBe(true);
    expect(existsSync(join(tempDir, 'temp', 'sess'))).toBe(true);
  });

  test('loadHooksConfig merges user and project hooks', async () => {
    const userHooksPath = join(tempDir, 'hooks.json');
    writeFileSync(
      userHooksPath,
      JSON.stringify(
        { hooks: { PreToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'echo ok' }] }] } },
        null,
        2
      )
    );

    const projectDir = mkdtempSync(join(tmpdir(), 'oldpal-project-'));
    const projectHooksDir = join(projectDir, '.oldpal');
    mkdirSync(projectHooksDir, { recursive: true });
    writeFileSync(
      join(projectHooksDir, 'hooks.json'),
      JSON.stringify(
        { hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'echo ok' }] }] } },
        null,
        2
      )
    );

    const hooks = await loadHooksConfig(projectDir);
    expect(hooks.PreToolUse?.length).toBe(1);
    expect(hooks.PostToolUse?.length).toBe(1);

    rmSync(projectDir, { recursive: true, force: true });
  });

  test('loadSystemPrompt combines global and project prompts', async () => {
    writeFileSync(join(tempDir, 'OLDPAL.md'), 'global');

    const projectDir = mkdtempSync(join(tmpdir(), 'oldpal-project-'));
    const projectConfigDir = join(projectDir, '.oldpal');
    mkdirSync(projectConfigDir, { recursive: true });
    writeFileSync(join(projectConfigDir, 'OLDPAL.md'), 'project');

    const prompt = await loadSystemPrompt(projectDir);
    expect(prompt).toContain('global');
    expect(prompt).toContain('project');
    expect(prompt).toContain('---');

    rmSync(projectDir, { recursive: true, force: true });
  });

  test('loadSystemPrompt returns null when no prompt files exist', async () => {
    const prompt = await loadSystemPrompt(tempDir);
    expect(prompt).toBeNull();
  });

  test('loadSystemPrompt tolerates read errors', async () => {
    const originalFile = Bun.file;
    try {
      (Bun as any).file = () => {
        throw new Error('boom');
      };
      const prompt = await loadSystemPrompt(tempDir);
      expect(prompt).toBeNull();
    } finally {
      (Bun as any).file = originalFile;
    }
  });

  test('loadConfig ignores invalid JSON files', async () => {
    const invalidPath = join(tempDir, 'settings.json');
    writeFileSync(invalidPath, '{ invalid json');
    const loaded = await loadConfig(tempDir);
    expect(loaded.llm.provider).toBeDefined();
  });

  test('getTempFolder uses config dir', () => {
    const tempPath = getTempFolder('abc');
    expect(tempPath).toBe(join(tempDir, 'temp', 'abc'));
  });

  test('getConfigDir uses HOME when OLDPAL_DIR is unset', () => {
    const originalOldpalDir = process.env.OLDPAL_DIR;
    const originalHome = process.env.HOME;
    const homeDir = join(tempDir, 'home');
    mkdirSync(homeDir, { recursive: true });

    delete process.env.OLDPAL_DIR;
    process.env.HOME = homeDir;

    try {
      expect(getConfigDir()).toBe(join(homeDir, '.oldpal'));
    } finally {
      process.env.OLDPAL_DIR = originalOldpalDir;
      process.env.HOME = originalHome;
    }
  });
});

import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, symlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateBashCommand } from '../src/security/bash-validator';
import { isPathSafe } from '../src/security/path-validator';
import { SecurityLogger } from '../src/security/logger';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Bash Security', () => {
  test('should block dangerous commands', () => {
    const result = validateBashCommand('rm -rf /');
    expect(result.valid).toBe(false);
  });

  test('should detect command substitution', () => {
    const result = validateBashCommand('echo $(whoami)');
    expect(result.valid).toBe(false);
  });

  test('should allow safe commands', () => {
    const result = validateBashCommand('ls -la');
    expect(result.valid).toBe(true);
  });
});

describe('Path Security', () => {
  test('should block symlink outside working directory', async () => {
    const base = await mkdtemp(join(tmpdir(), 'assistants-sec-'));
    const outside = await mkdtemp(join(tmpdir(), 'assistants-outside-'));
    const target = join(outside, 'secret.txt');
    await writeFile(target, 'secret');

    const linkPath = join(base, 'link.txt');
    await symlink(target, linkPath);

    const result = await isPathSafe(linkPath, 'read', { cwd: base });
    expect(result.safe).toBe(false);
  });

  test('should block reads of protected paths', async () => {
    const result = await isPathSafe('/etc/passwd', 'read');
    expect(result.safe).toBe(false);
  });
});

describe('Security Logger', () => {
  test('should log and persist events', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'assistants-sec-log-'));
    const logFile = join(logDir, 'security.log');
    const logger = new SecurityLogger(logFile);

    logger.log({
      eventType: 'blocked_command',
      severity: 'high',
      details: {
        tool: 'bash',
        command: 'rm -rf /',
        reason: 'Blocked command',
      },
      sessionId: 'test-session',
    });

    await wait(10);

    const events = logger.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('blocked_command');

    const content = await readFile(logFile, 'utf-8');
    expect(content).toContain('blocked_command');
  });
});

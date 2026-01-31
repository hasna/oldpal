import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentLoop } from '../src/agent/loop';

let tempDir: string;
let originalOldpalDir: string | undefined;

beforeEach(() => {
  originalOldpalDir = process.env.OLDPAL_DIR;
  tempDir = mkdtempSync(join(tmpdir(), 'oldpal-init-'));
  process.env.OLDPAL_DIR = tempDir;

  // Minimal config to avoid connector discovery and provide API key
  writeFileSync(
    join(tempDir, 'settings.json'),
    JSON.stringify(
      {
        llm: { provider: 'anthropic', model: 'mock', apiKey: 'test-key' },
        connectors: [],
      },
      null,
      2
    )
  );
});

afterEach(() => {
  process.env.OLDPAL_DIR = originalOldpalDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('AgentLoop initialize', () => {
  test('initializes tools and commands', async () => {
    const agent = new AgentLoop({ cwd: tempDir });
    await agent.initialize();

    const tools = agent.getTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});

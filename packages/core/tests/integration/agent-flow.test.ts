import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentLoop } from '../../src/agent/loop';
import { MockLLMClient } from '../fixtures/mock-llm';

let tempDir: string;
let originalOldpalDir: string | undefined;

beforeEach(() => {
  originalOldpalDir = process.env.OLDPAL_DIR;
  tempDir = mkdtempSync(join(tmpdir(), 'oldpal-agent-flow-'));
  process.env.OLDPAL_DIR = tempDir;
});

afterEach(() => {
  process.env.OLDPAL_DIR = originalOldpalDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Agent flow integration', () => {
  test('processes a simple conversation using injected LLM', async () => {
    const mockLLM = new MockLLMClient();
    mockLLM.queueResponse({ content: 'Hello from mock' });

    const agent = new AgentLoop({
      cwd: tempDir,
      sessionId: 'sess-test',
      llmClient: mockLLM,
    });

    await agent.initialize();
    await agent.process('Hi');

    const messages = agent.getContext().getMessages();
    const last = messages[messages.length - 1];

    expect(last.role).toBe('assistant');
    expect(last.content).toContain('Hello from mock');
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentLoop } from '../../src/agent/loop';
import { MockLLMClient } from '../fixtures/mock-llm';

let tempDir: string;
let originalAssistantsDir: string | undefined;

beforeEach(() => {
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-agent-flow-'));
  process.env.ASSISTANTS_DIR = tempDir;
});

afterEach(() => {
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
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

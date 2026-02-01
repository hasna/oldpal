# Plan: Test Coverage Enhancement

**Plan ID:** 00008
**Status:** Completed
**Priority:** High
**Estimated Effort:** Large (5+ days)
**Dependencies:** None

---

## Overview

Increase test coverage across all packages with unit tests, integration tests, and E2E tests. Target 80%+ coverage for critical paths.

## Current State

- Minimal test coverage
- Some unit tests exist but incomplete
- No E2E tests
- No integration tests
- No CI test automation

## Requirements

### Functional
1. Unit tests for all core modules
2. Integration tests for tool execution
3. E2E tests for CLI interactions
4. Mocking infrastructure for LLM calls
5. Test fixtures and helpers

### Non-Functional
1. Tests should run in <60 seconds
2. Coverage reports generated automatically
3. Tests must pass before merge
4. Flaky tests should be identified and fixed

## Technical Design

### Test Structure

```
packages/
├── core/
│   └── tests/
│       ├── unit/
│       │   ├── tools/
│       │   │   ├── bash.test.ts
│       │   │   ├── filesystem.test.ts
│       │   │   └── web.test.ts
│       │   ├── hooks/
│       │   │   ├── executor.test.ts
│       │   │   └── loader.test.ts
│       │   ├── agent/
│       │   │   └── loop.test.ts
│       │   └── llm/
│       │       └── anthropic.test.ts
│       ├── integration/
│       │   ├── tool-execution.test.ts
│       │   ├── hook-flow.test.ts
│       │   └── agent-flow.test.ts
│       └── fixtures/
│           ├── mock-llm.ts
│           ├── mock-tools.ts
│           └── test-files/
├── terminal/
│   └── tests/
│       ├── unit/
│       │   └── components/
│       │       ├── App.test.tsx
│       │       └── Messages.test.tsx
│       └── e2e/
│           ├── cli.test.ts
│           └── interactions.test.ts
└── shared/
    └── tests/
        └── unit/
            └── types.test.ts
```

### Mock LLM Client

```typescript
// packages/core/tests/fixtures/mock-llm.ts

interface MockResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason?: string;
}

class MockLLMClient implements LLMClient {
  private responses: MockResponse[] = [];
  private callHistory: { prompt: string; options: any }[] = [];

  queueResponse(response: MockResponse): void {
    this.responses.push(response);
  }

  queueToolCall(name: string, input: any): void {
    this.responses.push({
      content: '',
      toolCalls: [{
        id: `call_${Date.now()}`,
        name,
        input,
      }],
    });
  }

  async complete(prompt: string, options: any): Promise<string> {
    this.callHistory.push({ prompt, options });

    const response = this.responses.shift();
    if (!response) {
      throw new Error('No mock response queued');
    }

    return response.content;
  }

  async *stream(prompt: string, options: any): AsyncGenerator<StreamChunk> {
    this.callHistory.push({ prompt, options });

    const response = this.responses.shift();
    if (!response) {
      throw new Error('No mock response queued');
    }

    // Yield content in chunks
    for (const char of response.content) {
      yield { type: 'text_delta', text: char };
    }

    if (response.toolCalls) {
      for (const call of response.toolCalls) {
        yield { type: 'tool_use', toolCall: call };
      }
    }

    yield { type: 'message_stop', stopReason: response.stopReason || 'end_turn' };
  }

  getCallHistory(): typeof this.callHistory {
    return this.callHistory;
  }

  clearHistory(): void {
    this.callHistory = [];
    this.responses = [];
  }
}
```

### Test Helpers

```typescript
// packages/core/tests/fixtures/helpers.ts

export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'oldpal-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createTestAgent(options: Partial<AgentOptions> = {}): AgentLoop {
  return new AgentLoop({
    cwd: process.cwd(),
    sessionId: 'test-session',
    llmClient: new MockLLMClient(),
    ...options,
  });
}

export function createTestMessage(
  role: 'user' | 'assistant',
  content: string
): Message {
  return {
    id: `msg_${Date.now()}`,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Condition not met within timeout');
}
```

### Unit Test Example

```typescript
// packages/core/tests/unit/tools/bash.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { BashTool } from '../../../src/tools/bash';
import { withTempDir } from '../../fixtures/helpers';

describe('BashTool', () => {
  let tool: BashTool;

  beforeEach(() => {
    tool = new BashTool({ allowlist: ['echo', 'ls', 'cat'] });
  });

  describe('execute', () => {
    it('should execute allowed commands', async () => {
      const result = await tool.execute({ command: 'echo hello' });
      expect(result.content).toBe('hello\n');
      expect(result.isError).toBe(false);
    });

    it('should reject blocked commands', async () => {
      const result = await tool.execute({ command: 'rm -rf /' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('not allowed');
    });

    it('should handle command timeout', async () => {
      const result = await tool.execute({
        command: 'sleep 10',
        timeout: 100,
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('timeout');
    });

    it('should capture stderr', async () => {
      const result = await tool.execute({
        command: 'cat nonexistent.txt',
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('No such file');
    });
  });

  describe('working directory', () => {
    it('should execute in specified directory', async () => {
      await withTempDir(async (dir) => {
        const result = await tool.execute({
          command: 'pwd',
          cwd: dir,
        });
        expect(result.content.trim()).toBe(dir);
      });
    });
  });
});
```

### Integration Test Example

```typescript
// packages/core/tests/integration/agent-flow.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentLoop } from '../../src/agent/loop';
import { MockLLMClient } from '../fixtures/mock-llm';
import { withTempDir } from '../fixtures/helpers';

describe('Agent Flow Integration', () => {
  let agent: AgentLoop;
  let mockLLM: MockLLMClient;

  beforeEach(async () => {
    mockLLM = new MockLLMClient();
  });

  it('should complete a simple conversation', async () => {
    await withTempDir(async (dir) => {
      agent = new AgentLoop({
        cwd: dir,
        sessionId: 'test',
        llmClient: mockLLM,
      });

      mockLLM.queueResponse({
        content: 'Hello! How can I help you?',
      });

      await agent.initialize();
      const response = await agent.processMessage('Hello');

      expect(response).toContain('Hello');
      expect(mockLLM.getCallHistory()).toHaveLength(1);
    });
  });

  it('should execute tool calls', async () => {
    await withTempDir(async (dir) => {
      // Create test file
      await writeFile(join(dir, 'test.txt'), 'Hello World');

      agent = new AgentLoop({
        cwd: dir,
        sessionId: 'test',
        llmClient: mockLLM,
      });

      // Queue tool call followed by response
      mockLLM.queueToolCall('read', { path: 'test.txt' });
      mockLLM.queueResponse({
        content: 'The file contains: Hello World',
      });

      await agent.initialize();
      const response = await agent.processMessage('Read test.txt');

      expect(response).toContain('Hello World');
    });
  });

  it('should handle tool errors gracefully', async () => {
    await withTempDir(async (dir) => {
      agent = new AgentLoop({
        cwd: dir,
        sessionId: 'test',
        llmClient: mockLLM,
      });

      mockLLM.queueToolCall('read', { path: 'nonexistent.txt' });
      mockLLM.queueResponse({
        content: 'The file does not exist.',
      });

      await agent.initialize();
      const response = await agent.processMessage('Read nonexistent.txt');

      expect(response).toContain('does not exist');
    });
  });
});
```

### E2E Test Example

```typescript
// packages/terminal/tests/e2e/cli.test.ts

import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';

describe('CLI E2E', () => {
  const cliPath = join(__dirname, '../../dist/index.js');

  it('should show version with --version', async () => {
    const output = await runCli(['--version']);
    expect(output).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should show help with --help', async () => {
    const output = await runCli(['--help']);
    expect(output).toContain('Usage:');
    expect(output).toContain('Options:');
  });

  it('should handle /help command', async () => {
    const output = await runCli([], '/help\n/exit\n');
    expect(output).toContain('Available commands');
  });

  async function runCli(args: string[], stdin = ''): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [cliPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      if (stdin) {
        proc.stdin.write(stdin);
        proc.stdin.end();
      }

      proc.on('close', (code) => {
        if (code === 0 || stdin.includes('/exit')) {
          resolve(stdout);
        } else {
          reject(new Error(`CLI exited with code ${code}: ${stderr}`));
        }
      });

      // Timeout
      setTimeout(() => {
        proc.kill();
        reject(new Error('CLI timeout'));
      }, 10000);
    });
  }
});
```

## Implementation Steps

### Step 1: Setup Test Infrastructure
- [x] Configure Bun test runner
- [x] Add coverage reporting
- [x] Create test scripts in package.json
- [x] Setup CI test workflow

**Files:**
- `vitest.config.ts`
- `package.json`
- `.github/workflows/test.yml`

### Step 2: Create Test Fixtures
- [x] Implement MockLLMClient
- [x] Create test helpers
- [x] Add test file fixtures
- [x] Setup temp directory helpers

**Files:**
- `packages/core/tests/fixtures/mock-llm.ts`
- `packages/core/tests/fixtures/helpers.ts`
- `packages/core/tests/fixtures/test-files/`

### Step 3: Write Unit Tests - Core
- [x] Test bash tool
- [x] Test filesystem tools
- [x] Test web tool
- [x] Test connector tool
- [x] Test hook executor
- [x] Test hook loader

**Files:**
- `packages/core/tests/unit/tools/*.test.ts`
- `packages/core/tests/unit/hooks/*.test.ts`

### Step 4: Write Unit Tests - Agent
- [x] Test AgentLoop
- [x] Test message processing
- [x] Test tool dispatch

**Files:**
- `packages/core/tests/unit/agent/*.test.ts`

### Step 5: Write Integration Tests
- [x] Test complete agent flows
- [x] Test hook execution flows
- [x] Test error handling flows

**Files:**
- `packages/core/tests/integration/*.test.ts`

### Step 6: Write E2E Tests
- [x] Test CLI startup
- [x] Test commands
- [x] Test interactions

**Files:**
- `packages/terminal/tests/e2e/*.test.ts`

### Step 7: Achieve Coverage Target
- [x] Identify coverage gaps
- [x] Add missing tests
- [x] Fix flaky tests
- [x] Document test patterns

**Files:**
- Various test files

## Testing Strategy

Coverage targets by package:
- `packages/core`: 80%+
- `packages/terminal`: 70%+
- `packages/shared`: 90%+

Priority areas:
1. Tool execution (critical path)
2. Error handling (reliability)
3. Hook system (security)
4. Agent loop (core functionality)

## Rollout Plan

1. Setup test infrastructure
2. Create fixtures and helpers
3. Write unit tests (2 days)
4. Write integration tests (1 day)
5. Write E2E tests (1 day)
6. Achieve coverage target
7. Setup CI automation

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tests too slow | Medium | Parallel execution, smart mocking |
| Flaky tests | High | Deterministic tests, proper cleanup |
| Hard to mock LLM | Medium | Good mock infrastructure |
| Coverage gaming | Low | Focus on critical paths |

---

## Approval

- [x] Technical design approved
- [x] Implementation steps clear
- [x] Tests defined
- [x] Ready to implement

# Plan: Implement Prompt & Agent Hooks

**Plan ID:** 00001
**Status:** Draft
**Priority:** High
**Estimated Effort:** Medium (2-3 days)
**Dependencies:** None

---

## Overview

Implement the `executePromptHook` and `executeAgentHook` functions in the hook executor to enable single-turn LLM decisions and multi-turn subagent hooks.

## Current State

- File: `packages/core/src/hooks/executor.ts` (lines 172-200)
- Both functions are stubs that log and return `null`
- Command hooks work correctly
- No LLM client access in HookExecutor

## Requirements

### Functional
1. Prompt hooks should make a single LLM call with the hook prompt + input context
2. Agent hooks should spawn a subagent that can use tools to make a decision
3. Both should respect timeout configuration
4. Both should return proper HookOutput for blocking/allowing actions

### Non-Functional
1. Hooks should not significantly delay tool execution
2. Failed hooks should fail gracefully (not block by default)
3. Hook LLM calls should use a smaller/faster model option

## Technical Design

### Changes to HookExecutor

```typescript
// Add LLM client dependency
export class HookExecutor {
  private llmClient?: LLMClient;

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }
}
```

### executePromptHook Implementation

```typescript
private async executePromptHook(
  hook: HookHandler,
  input: HookInput,
  timeout: number
): Promise<HookOutput | null> {
  if (!hook.prompt || !this.llmClient) return null;

  // Build prompt with input context
  const fullPrompt = `${hook.prompt}

Context:
${JSON.stringify(input, null, 2)}

Respond with JSON: { "allow": boolean, "reason": string }`;

  try {
    const response = await Promise.race([
      this.llmClient.complete(fullPrompt, { maxTokens: 200 }),
      sleep(timeout).then(() => { throw new Error('timeout'); })
    ]);

    const decision = JSON.parse(response);
    return {
      continue: decision.allow,
      stopReason: decision.allow ? undefined : decision.reason,
    };
  } catch (error) {
    console.error('Prompt hook error:', error);
    return null; // Don't block on error
  }
}
```

### executeAgentHook Implementation

```typescript
private async executeAgentHook(
  hook: HookHandler,
  input: HookInput,
  timeout: number
): Promise<HookOutput | null> {
  if (!hook.prompt) return null;

  // Create lightweight subagent
  const subagent = new AgentLoop({
    cwd: process.cwd(),
    sessionId: `hook-${generateId()}`,
    allowedTools: hook.allowedTools || ['read', 'glob', 'grep'],
    extraSystemPrompt: `You are a hook agent evaluating whether to allow an action.
Your task: ${hook.prompt}

After analysis, respond with: ALLOW or DENY followed by reason.`,
  });

  try {
    await subagent.initialize();

    // Run subagent with timeout
    const result = await Promise.race([
      subagent.processMessage(JSON.stringify(input)),
      sleep(timeout).then(() => { throw new Error('timeout'); })
    ]);

    // Parse subagent response
    const allow = result.includes('ALLOW');
    return {
      continue: allow,
      stopReason: allow ? undefined : result,
    };
  } catch (error) {
    console.error('Agent hook error:', error);
    return null;
  } finally {
    // Cleanup subagent
  }
}
```

## Implementation Steps

### Step 1: Add LLM Client to HookExecutor
- [ ] Add `llmClient` property to HookExecutor
- [ ] Add `setLLMClient()` method
- [ ] Update AgentLoop to pass LLM client after initialization

**Files:**
- `packages/core/src/hooks/executor.ts`
- `packages/core/src/agent/loop.ts`

### Step 2: Implement executePromptHook
- [ ] Build prompt template with input injection
- [ ] Call LLM with timeout
- [ ] Parse JSON response
- [ ] Return HookOutput

**Files:**
- `packages/core/src/hooks/executor.ts`

### Step 3: Implement executeAgentHook
- [ ] Create subagent factory function
- [ ] Initialize subagent with restricted tools
- [ ] Run subagent with timeout
- [ ] Parse response for ALLOW/DENY
- [ ] Cleanup subagent resources

**Files:**
- `packages/core/src/hooks/executor.ts`
- `packages/core/src/agent/subagent.ts` (new)

### Step 4: Add Tests
- [ ] Test prompt hook with mock LLM
- [ ] Test agent hook with mock subagent
- [ ] Test timeout behavior
- [ ] Test error handling

**Files:**
- `packages/core/tests/hooks-execution.test.ts`

## Testing Strategy

```typescript
describe('executePromptHook', () => {
  it('should call LLM with formatted prompt');
  it('should return allow=true for positive response');
  it('should return allow=false with reason for negative response');
  it('should return null on timeout');
  it('should return null on LLM error');
});

describe('executeAgentHook', () => {
  it('should create subagent with restricted tools');
  it('should parse ALLOW response correctly');
  it('should parse DENY response correctly');
  it('should cleanup subagent after execution');
  it('should respect timeout');
});
```

## Rollout Plan

1. Implement prompt hooks first (simpler)
2. Test with real hooks in dev environment
3. Implement agent hooks
4. Add configuration for hook model selection
5. Document hook authoring guide

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Hook latency slows tool execution | Medium | Use faster model, aggressive timeouts |
| Subagent runs forever | High | Hard timeout, max turns limit |
| Hook errors block actions | High | Default to allow on error |
| LLM cost from hooks | Low | Cache similar hook decisions |

## Open Questions

1. Should hook decisions be cached for identical inputs?
2. What model should be used for hook LLM calls?
3. Should there be a global hook enable/disable setting?
4. How to handle hook configuration validation?

---

## Approval

- [ ] Technical design approved
- [ ] Implementation steps clear
- [ ] Tests defined
- [ ] Ready to implement

# Plan: Error Handling & Recovery System

**Plan ID:** 00002
**Status:** Completed
**Priority:** High
**Estimated Effort:** Large (4-5 days)
**Dependencies:** None

---

## Overview

Implement a comprehensive error handling system with typed errors, categorization, retry logic, and actionable error messages.

## Current State

- Errors are caught with generic try/catch blocks
- Most errors return plain strings
- No distinction between error types
- No retry logic for transient failures
- Many errors silently ignored (empty catch blocks)

## Requirements

### Functional
1. All errors should be typed with proper error classes
2. Errors should be categorized (recoverable, fatal, user-caused, system-caused)
3. Retryable operations should have automatic retry with backoff
4. Error messages should include actionable suggestions

### Non-Functional
1. Error handling should not significantly impact performance
2. Stack traces should be available in debug mode
3. Errors should be aggregated for observability

## Technical Design

### Error Type Hierarchy

```typescript
// packages/core/src/errors.ts

export class AssistantError extends Error {
  code: string;
  recoverable: boolean;
  retryable: boolean;
  userFacing: boolean;
  suggestion?: string;
  cause?: Error;

  constructor(message: string, options: AssistantErrorOptions) {
    super(message);
    this.name = 'AssistantError';
    this.code = options.code;
    this.recoverable = options.recoverable ?? true;
    this.retryable = options.retryable ?? false;
    this.userFacing = options.userFacing ?? true;
    this.suggestion = options.suggestion;
    this.cause = options.cause;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
    };
  }
}

// Specific error types
export class ToolExecutionError extends AssistantError {
  toolName: string;
  toolInput: unknown;
}

export class LLMError extends AssistantError {
  statusCode?: number;
  rateLimited?: boolean;
}

export class ConfigurationError extends AssistantError {
  configPath?: string;
}

export class ConnectorError extends AssistantError {
  connectorName: string;
  command?: string;
}

export class ValidationError extends AssistantError {
  field?: string;
  expected?: string;
  received?: string;
}

export class HookError extends AssistantError {
  hookType: string;
  hookName?: string;
}
```

### Error Codes

```typescript
export const ErrorCodes = {
  // Tool errors (TOOL_xxx)
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
  TOOL_PERMISSION_DENIED: 'TOOL_PERMISSION_DENIED',

  // LLM errors (LLM_xxx)
  LLM_API_ERROR: 'LLM_API_ERROR',
  LLM_RATE_LIMITED: 'LLM_RATE_LIMITED',
  LLM_CONTEXT_TOO_LONG: 'LLM_CONTEXT_TOO_LONG',
  LLM_INVALID_RESPONSE: 'LLM_INVALID_RESPONSE',

  // Config errors (CONFIG_xxx)
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_PERMISSION_DENIED: 'CONFIG_PERMISSION_DENIED',

  // Connector errors (CONNECTOR_xxx)
  CONNECTOR_NOT_FOUND: 'CONNECTOR_NOT_FOUND',
  CONNECTOR_AUTH_FAILED: 'CONNECTOR_AUTH_FAILED',
  CONNECTOR_EXECUTION_FAILED: 'CONNECTOR_EXECUTION_FAILED',

  // Validation errors (VALIDATION_xxx)
  VALIDATION_REQUIRED_FIELD: 'VALIDATION_REQUIRED_FIELD',
  VALIDATION_INVALID_TYPE: 'VALIDATION_INVALID_TYPE',
  VALIDATION_OUT_OF_RANGE: 'VALIDATION_OUT_OF_RANGE',
} as const;
```

### Retry Logic

```typescript
// packages/core/src/utils/retry.ts

interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  retryOn?: (error: Error) => boolean;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if should retry
      if (attempt === options.maxRetries) break;
      if (options.retryOn && !options.retryOn(lastError)) break;

      // Calculate delay with exponential backoff
      const delay = Math.min(
        options.baseDelay * Math.pow(options.backoffFactor, attempt),
        options.maxDelay
      );

      await sleep(delay);
    }
  }

  throw lastError!;
}

// Predefined retry configs
export const LLMRetryConfig: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  retryOn: (error) => error instanceof LLMError && error.rateLimited,
};

export const ConnectorRetryConfig: RetryOptions = {
  maxRetries: 2,
  baseDelay: 500,
  maxDelay: 5000,
  backoffFactor: 2,
};
```

### Error Aggregation

```typescript
// packages/core/src/errors/aggregator.ts

interface ErrorStats {
  code: string;
  count: number;
  lastOccurrence: string;
  samples: string[];
}

class ErrorAggregator {
  private stats: Map<string, ErrorStats> = new Map();

  record(error: AssistantError): void {
    const existing = this.stats.get(error.code);
    if (existing) {
      existing.count++;
      existing.lastOccurrence = new Date().toISOString();
      if (existing.samples.length < 5) {
        existing.samples.push(error.message);
      }
    } else {
      this.stats.set(error.code, {
        code: error.code,
        count: 1,
        lastOccurrence: new Date().toISOString(),
        samples: [error.message],
      });
    }
  }

  getStats(): ErrorStats[] {
    return Array.from(this.stats.values());
  }

  clear(): void {
    this.stats.clear();
  }
}
```

## Implementation Steps

### Step 1: Create Error Types
- [x] Create `packages/core/src/errors/index.ts`
- [x] Define base `AssistantError` class
- [x] Define specific error classes
- [x] Define error codes enum
- [x] Export all from package

**Files:**
- `packages/core/src/errors/index.ts`
- `packages/core/src/errors/types.ts`
- `packages/core/src/errors/codes.ts`

### Step 2: Implement Retry Utility
- [x] Create retry wrapper function
- [x] Add exponential backoff logic
- [x] Add configurable retry conditions
- [x] Create preset configurations

**Files:**
- `packages/core/src/utils/retry.ts`

### Step 3: Update LLM Client
- [x] Replace generic errors with LLMError
- [x] Add retry logic for rate limits
- [x] Include suggestions in errors

**Files:**
- `packages/core/src/llm/anthropic.ts`

### Step 4: Update Tool Execution
- [x] Replace string errors with ToolExecutionError
- [x] Add timeout error handling
- [x] Include tool context in errors

**Files:**
- `packages/core/src/tools/registry.ts`
- `packages/core/src/tools/bash.ts`
- `packages/core/src/tools/filesystem.ts`
- `packages/core/src/tools/web.ts`
- `packages/core/src/tools/connector.ts`

### Step 5: Update Connectors
- [x] Create ConnectorError type
- [x] Add auth refresh + retry
- [x] Include connector context

**Files:**
- `packages/core/src/tools/connector.ts`

### Step 6: Add Error Aggregation
- [x] Implement ErrorAggregator
- [x] Integrate with agent loop
- [x] Expose via /status command

**Files:**
- `packages/core/src/errors/aggregator.ts`
- `packages/core/src/agent/loop.ts`
- `packages/core/src/commands/builtin.ts`

### Step 7: Update UI Error Display
- [x] Format errors with suggestions
- [x] Show error codes in debug mode
- [x] Color-code by severity

**Files:**
- `packages/terminal/src/components/App.tsx`

### Step 8: Add Tests
- [x] Test error type hierarchy
- [x] Test retry logic
- [x] Test error aggregation
- [x] Test UI error display

**Files:**
- `packages/core/tests/errors.test.ts`
- `packages/core/tests/retry.test.ts`

## Testing Strategy

```typescript
describe('AssistantError', () => {
  it('should include all required fields');
  it('should serialize to JSON correctly');
  it('should preserve cause chain');
});

describe('withRetry', () => {
  it('should retry on retryable errors');
  it('should not retry on non-retryable errors');
  it('should respect max retries');
  it('should apply exponential backoff');
});

describe('ErrorAggregator', () => {
  it('should count errors by code');
  it('should track last occurrence');
  it('should limit sample collection');
});
```

## Rollout Plan

1. Create error types (no breaking changes)
2. Add retry utility
3. Migrate LLM client errors
4. Migrate tool errors progressively
5. Add error aggregation
6. Update UI

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing error handling | Medium | Gradual migration, backwards compat |
| Retry loops cause delays | Medium | Configurable timeouts, max retries |
| Error aggregation memory growth | Low | Periodic cleanup, size limits |

---

## Approval

- [x] Technical design approved
- [x] Implementation steps clear
- [x] Tests defined
- [x] Ready to implement

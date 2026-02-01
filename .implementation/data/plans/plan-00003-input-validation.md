# Plan: Input Validation & Sanitization

**Plan ID:** 00003
**Status:** Draft
**Priority:** High
**Estimated Effort:** Medium (3 days)
**Dependencies:** plan-00002 (Error Handling)

---

## Overview

Implement comprehensive input validation for tool inputs, LLM responses, and user messages to prevent security issues and improve reliability.

## Current State

- Basic path validation in filesystem tools
- Bash command allowlist exists
- No JSON schema validation for tool inputs
- No LLM response validation
- No message size limits
- Symlinks not resolved before validation

## Requirements

### Functional
1. Validate all tool inputs against their JSON schemas before execution
2. Validate LLM responses for well-formed tool calls
3. Enforce message size limits
4. Resolve and validate symlinks in file paths

### Non-Functional
1. Validation should add minimal latency (<5ms per tool call)
2. Validation errors should be descriptive and actionable
3. Validation should be configurable (strict/lenient modes)

## Technical Design

### Schema Validation

```typescript
// packages/core/src/validation/schema.ts

import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, coerceTypes: true });

interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
  coerced?: Record<string, unknown>;
}

function validateToolInput(
  toolName: string,
  schema: object,
  input: unknown
): ValidationResult {
  const validate = ajv.compile(schema);
  const inputCopy = structuredClone(input);

  const valid = validate(inputCopy);

  if (!valid) {
    return {
      valid: false,
      errors: validate.errors?.map(err => new ValidationError(
        `${toolName}: ${err.instancePath} ${err.message}`,
        {
          code: 'VALIDATION_SCHEMA_ERROR',
          field: err.instancePath,
          expected: err.params?.type,
          received: typeof input,
        }
      )),
    };
  }

  return { valid: true, coerced: inputCopy };
}
```

### Path Validation

```typescript
// packages/core/src/validation/paths.ts

import { resolve, normalize } from 'path';
import { realpath, lstat } from 'fs/promises';

interface PathValidationOptions {
  allowSymlinks?: boolean;
  allowedPaths?: string[];
  blockedPaths?: string[];
  maxDepth?: number;
}

async function validatePath(
  inputPath: string,
  options: PathValidationOptions = {}
): Promise<{ valid: boolean; resolved: string; error?: string }> {
  const normalized = normalize(inputPath);
  const resolved = resolve(normalized);

  // Check for path traversal
  if (normalized.includes('..')) {
    // Resolve and check if still within allowed bounds
    const real = await realpath(resolved).catch(() => resolved);
    if (!isWithinAllowed(real, options.allowedPaths)) {
      return { valid: false, resolved, error: 'Path traversal detected' };
    }
  }

  // Resolve symlinks if not allowed
  if (!options.allowSymlinks) {
    try {
      const stat = await lstat(resolved);
      if (stat.isSymbolicLink()) {
        const target = await realpath(resolved);
        if (!isWithinAllowed(target, options.allowedPaths)) {
          return { valid: false, resolved, error: 'Symlink points outside allowed paths' };
        }
      }
    } catch {
      // File doesn't exist yet, that's ok for writes
    }
  }

  // Check blocked paths
  if (options.blockedPaths?.some(blocked => resolved.startsWith(blocked))) {
    return { valid: false, resolved, error: 'Path is in blocked list' };
  }

  return { valid: true, resolved };
}

function isWithinAllowed(path: string, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.some(a => path.startsWith(a));
}
```

### Message Size Limits

```typescript
// packages/core/src/validation/limits.ts

interface SizeLimits {
  maxUserMessageLength: number;      // 100,000 chars
  maxToolOutputLength: number;       // 50,000 chars
  maxTotalContextTokens: number;     // 180,000 tokens
  maxFileReadSize: number;           // 10MB
}

const DEFAULT_LIMITS: SizeLimits = {
  maxUserMessageLength: 100_000,
  maxToolOutputLength: 50_000,
  maxTotalContextTokens: 180_000,
  maxFileReadSize: 10 * 1024 * 1024,
};

function enforceMessageLimit(message: string, limit: number): string {
  if (message.length <= limit) return message;
  return message.slice(0, limit - 100) +
    `\n\n[Truncated: ${message.length - limit + 100} characters removed]`;
}

function enforceToolOutputLimit(output: string, limit: number): string {
  if (output.length <= limit) return output;
  // Keep beginning and end for context
  const keepStart = Math.floor(limit * 0.7);
  const keepEnd = Math.floor(limit * 0.2);
  return output.slice(0, keepStart) +
    `\n\n[... ${output.length - keepStart - keepEnd} characters truncated ...]\n\n` +
    output.slice(-keepEnd);
}
```

### LLM Response Validation

```typescript
// packages/core/src/validation/llm-response.ts

interface LLMResponseValidation {
  valid: boolean;
  toolCalls: ValidatedToolCall[];
  textContent: string;
  errors: string[];
}

function validateLLMResponse(
  response: unknown,
  availableTools: Map<string, Tool>
): LLMResponseValidation {
  const errors: string[] = [];
  const toolCalls: ValidatedToolCall[] = [];
  let textContent = '';

  // Parse response structure
  if (!response || typeof response !== 'object') {
    return { valid: false, toolCalls: [], textContent: '', errors: ['Invalid response format'] };
  }

  const content = (response as any).content;
  if (!Array.isArray(content)) {
    return { valid: false, toolCalls: [], textContent: '', errors: ['Missing content array'] };
  }

  for (const block of content) {
    if (block.type === 'text') {
      textContent += block.text || '';
    } else if (block.type === 'tool_use') {
      // Validate tool exists
      if (!availableTools.has(block.name)) {
        errors.push(`Unknown tool: ${block.name}`);
        continue;
      }

      // Validate tool input
      const tool = availableTools.get(block.name)!;
      const validation = validateToolInput(block.name, tool.parameters, block.input);

      if (!validation.valid) {
        errors.push(`Invalid input for ${block.name}: ${validation.errors?.map(e => e.message).join(', ')}`);
        continue;
      }

      toolCalls.push({
        id: block.id,
        name: block.name,
        input: validation.coerced || block.input,
      });
    }
  }

  return {
    valid: errors.length === 0,
    toolCalls,
    textContent,
    errors,
  };
}
```

## Implementation Steps

### Step 1: Add Schema Validation Library
- [ ] Add `ajv` dependency
- [ ] Create schema validation module
- [ ] Add type coercion support

**Files:**
- `package.json`
- `packages/core/src/validation/schema.ts`

### Step 2: Implement Path Validation
- [ ] Create path validation module
- [ ] Add symlink resolution
- [ ] Add traversal detection
- [ ] Integrate with filesystem tools

**Files:**
- `packages/core/src/validation/paths.ts`
- `packages/core/src/tools/filesystem.ts`

### Step 3: Implement Size Limits
- [ ] Create limits module
- [ ] Add message truncation
- [ ] Add tool output truncation
- [ ] Integrate with agent loop

**Files:**
- `packages/core/src/validation/limits.ts`
- `packages/core/src/agent/loop.ts`

### Step 4: Implement LLM Response Validation
- [ ] Create response validation module
- [ ] Validate tool names exist
- [ ] Validate tool inputs match schemas
- [ ] Integrate with LLM client

**Files:**
- `packages/core/src/validation/llm-response.ts`
- `packages/core/src/llm/anthropic.ts`

### Step 5: Integrate with Tool Registry
- [ ] Add pre-execution validation hook
- [ ] Validate inputs before calling executor
- [ ] Return validation errors appropriately

**Files:**
- `packages/core/src/tools/registry.ts`

### Step 6: Add Configuration
- [ ] Add validation config to settings
- [ ] Support strict/lenient modes
- [ ] Allow per-tool overrides

**Files:**
- `packages/core/src/config.ts`
- `packages/shared/src/types.ts`

### Step 7: Add Tests
- [ ] Test schema validation
- [ ] Test path validation
- [ ] Test size limits
- [ ] Test LLM response validation

**Files:**
- `packages/core/tests/validation.test.ts`

## Testing Strategy

```typescript
describe('validateToolInput', () => {
  it('should validate required fields');
  it('should coerce types when possible');
  it('should reject invalid types');
  it('should provide descriptive errors');
});

describe('validatePath', () => {
  it('should detect path traversal');
  it('should resolve symlinks');
  it('should enforce allowed paths');
  it('should block dangerous paths');
});

describe('enforceMessageLimit', () => {
  it('should not modify messages under limit');
  it('should truncate with notice');
});

describe('validateLLMResponse', () => {
  it('should reject unknown tools');
  it('should validate tool inputs');
  it('should extract text content');
});
```

## Rollout Plan

1. Add validation library
2. Implement and test each validation type
3. Integrate with existing code gradually
4. Enable strict mode by default
5. Add configuration options

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Validation rejects valid inputs | High | Comprehensive testing, lenient mode |
| Performance impact | Medium | Caching compiled schemas |
| Breaking existing tools | Medium | Gradual rollout, feature flag |

---

## Approval

- [ ] Technical design approved
- [ ] Implementation steps clear
- [ ] Tests defined
- [ ] Ready to implement

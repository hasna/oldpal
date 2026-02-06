# Context Compaction Investigation Report

**Date:** 2024-01-15
**Task:** #824 - Investigate source of context compaction

## Executive Summary

Context compaction is **entirely internal** - the Anthropic API does NOT auto-compact. The issue causing assistant work interruption occurs because:

1. Compaction runs **before every LLM call** and silently replaces context
2. Tool calls in progress may get **summarized out** of context
3. The LLM **loses track** of what it was doing mid-task
4. There's **no continuation logic** to resume previous work

## Key Findings

### 1. Compaction Trigger Location

**File:** `packages/core/src/assistant/loop.ts`
**Line 591:** `await this.maybeSummarizeContext();`

This is called at the start of **every assistant loop iteration**, before the LLM call.

```typescript
while (turn < maxTurns && !this.shouldStop) {
  await this.maybeSummarizeContext();  // ← COMPACTION HERE
  const messages = this.context.getMessages();
  // ... then call LLM
}
```

### 2. When Compaction Triggers

**File:** `packages/core/src/context/manager.ts`
**Lines 26-54:** `processMessages()`

Triggers when current tokens exceed 80% of `maxContextTokens`:
```typescript
const ratioThreshold = this.config.maxContextTokens * this.config.summaryTriggerRatio;
if (estimated >= ratioThreshold) {
  // Perform summarization
}
```

**Default Configuration:** (`packages/core/src/assistant/loop.ts:1664-1688`)
- `maxContextTokens`: 128,000 (Anthropic's limit)
- `summaryTriggerRatio`: 0.8 (80% = 102,400 tokens)
- `summaryStrategy`: "hybrid" (extraction + LLM summary)

### 3. Token Counting Mechanism

**File:** `packages/core/src/context/token-counter.ts`

Uses character-based estimation:
```typescript
const CHARS_PER_TOKEN = 4; // Rough approximation
return Math.ceil(text.length / CHARS_PER_TOKEN);
```

**Issue:** This estimation may be inaccurate for JSON/structured data.

### 4. How Context Gets Replaced

**File:** `packages/core/src/context/manager.ts:713`
```typescript
this.context.import(result.messages);  // Replace old messages with summarized ones
```

The assistant then emits a notification but **immediately continues** to the next LLM call:
```typescript
const notice = `[Context summarized: ... messages, ... tokens]`;
this.emit({ type: 'text', content: notice });
```

### 5. Why Work Gets Interrupted

When compaction happens mid-task:

1. **Tool calls in progress get summarized** - The LLM loses track of pending tool execution
2. **Intermediate results disappear** - Step 2 of a 3-step task may be gone
3. **No pause for acknowledgment** - The assistant continues with new, fragmented context
4. **No continuation instructions** - The LLM doesn't know it should resume

### 6. What Causes Actual Assistant Stoppage

The assistant stops when:

| Trigger | Location | What Happens |
|---------|----------|--------------|
| API context error | `llm/anthropic.ts:311-318` | Returns `LLM_CONTEXT_TOO_LONG` error |
| Stream error | `assistant/loop.ts:622-625` | Loop breaks, error thrown |
| User stop | `assistant/loop.ts:637` | `shouldStop = true`, loop exits |
| Max turns | `assistant/loop.ts:583` | 50 iteration limit reached |
| No tool calls | `assistant/loop.ts:641` | Natural completion |

### 7. Anthropic API Behavior

The Anthropic API does **NOT** auto-compact. When context is too long:
- Returns HTTP 413 or error with "context too long" message
- Client must handle by truncating/summarizing
- No automatic retry or compression

## Failure Points

| Point | Location | Issue |
|-------|----------|-------|
| During Summarization | `context/manager.ts:85-166` | Messages replaced silently |
| Lost Tool Results | `assistant/context.ts:183-219` | Old messages pruned |
| Mid-Tool Execution | `assistant/loop.ts:656-659` | Results may be orphaned |

## Root Cause

The root cause of task #821 ("Context compaction interrupts active assistant work") is:

**After summarization completes and context is replaced, the LLM receives fragmented or missing context about ongoing work, causing it to:**
- Stop responding (no more tool calls)
- Repeat actions already completed
- Lose track of task state entirely

## Proposed Fix

Task #822 ("Preserve last N tool calls and results in context summarization") and Task #823 ("Auto-continue assistant work after context compaction") should:

1. **Preserve active tool context** through summarization
2. **Add continuation prompts** after compaction to remind the LLM what it was doing
3. **Keep recent tool calls/results** separate from summarizable content
4. **Consider adjusting trigger threshold** (80% may be too aggressive)

## Files Reviewed

```
packages/core/src/assistant/loop.ts - Assistant loop with compaction trigger
packages/core/src/context/manager.ts - Compaction logic
packages/core/src/context/token-counter.ts - Token estimation
packages/core/src/context/summarizer.ts - Summary generation
packages/core/src/llm/anthropic.ts - API error handling
```

# Plan: Context Summarization System

**Plan ID:** 00006
**Status:** Completed
**Priority:** High
**Estimated Effort:** Large (4-5 days)
**Dependencies:** plan-00002 (Error Handling)

---

## Overview

Implement automatic context summarization when conversation history exceeds token limits. This enables long-running sessions without losing important context while staying within model constraints.

## Current State

- No context management or summarization
- Conversations truncate when too long
- Important context lost in long sessions
- No token counting for messages
- No optimization of context window usage

## Requirements

### Functional
1. Count tokens accurately for messages
2. Trigger summarization before hitting limits
3. Preserve critical information in summaries
4. Support different summarization strategies
5. Allow manual summarization via command

### Non-Functional
1. Summarization should be fast (<10s)
2. Summaries should be high quality
3. System should be transparent about when it summarizes
4. Token counting should be accurate (±5%)

## Technical Design

### Token Counter

```typescript
// packages/core/src/context/token-counter.ts

import { Tiktoken, encoding_for_model } from 'tiktoken';

class TokenCounter {
  private encoder: Tiktoken;
  private cache: Map<string, number> = new Map();

  constructor(model: string = 'claude-3-sonnet') {
    // Use cl100k_base encoding as approximation for Claude
    this.encoder = encoding_for_model('gpt-4');
  }

  count(text: string): number {
    // Check cache first
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;

    const tokens = this.encoder.encode(text).length;

    // Cache if small enough
    if (text.length < 10000) {
      this.cache.set(text, tokens);
    }

    return tokens;
  }

  countMessages(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      // Add message overhead (~4 tokens per message)
      total += 4;
      total += this.count(msg.content);
      if (msg.toolCalls) {
        for (const call of msg.toolCalls) {
          total += this.count(JSON.stringify(call));
        }
      }
    }
    return total;
  }

  estimateResponse(prompt: string): number {
    // Rough estimate: response is ~0.5x prompt length
    return Math.floor(this.count(prompt) * 0.5);
  }
}
```

### Context Manager

```typescript
// packages/core/src/context/manager.ts

interface ContextConfig {
  maxContextTokens: number;      // e.g., 180,000
  targetContextTokens: number;   // e.g., 150,000 (leave room)
  summaryTriggerRatio: number;   // e.g., 0.8 (80% full triggers summary)
  keepRecentMessages: number;    // e.g., 10 (always keep last N)
  keepSystemPrompt: boolean;     // Always keep system prompt
}

interface ContextState {
  totalTokens: number;
  messageCount: number;
  summaryCount: number;
  lastSummaryAt?: string;
}

class ContextManager {
  private config: ContextConfig;
  private tokenCounter: TokenCounter;
  private summarizer: Summarizer;
  private state: ContextState;

  constructor(config: ContextConfig, summarizer: Summarizer) {
    this.config = config;
    this.tokenCounter = new TokenCounter();
    this.summarizer = summarizer;
    this.state = {
      totalTokens: 0,
      messageCount: 0,
      summaryCount: 0,
    };
  }

  async processMessages(messages: Message[]): Promise<Message[]> {
    const tokens = this.tokenCounter.countMessages(messages);
    this.state.totalTokens = tokens;
    this.state.messageCount = messages.length;

    // Check if summarization needed
    const threshold = this.config.maxContextTokens * this.config.summaryTriggerRatio;
    if (tokens > threshold) {
      return await this.summarizeAndCompress(messages);
    }

    return messages;
  }

  private async summarizeAndCompress(messages: Message[]): Promise<Message[]> {
    // Split messages into segments
    const systemPrompt = messages.find(m => m.role === 'system');
    const recentMessages = messages.slice(-this.config.keepRecentMessages);
    const toSummarize = messages.slice(
      systemPrompt ? 1 : 0,
      -this.config.keepRecentMessages
    );

    if (toSummarize.length === 0) {
      return messages; // Nothing to summarize
    }

    // Generate summary
    const summary = await this.summarizer.summarize(toSummarize);

    // Construct new message list
    const result: Message[] = [];

    if (systemPrompt) {
      result.push(systemPrompt);
    }

    // Add summary as a system message
    result.push({
      role: 'system',
      content: `[Context Summary - ${toSummarize.length} messages summarized]\n\n${summary}`,
    });

    // Add recent messages
    result.push(...recentMessages);

    this.state.summaryCount++;
    this.state.lastSummaryAt = new Date().toISOString();
    this.state.totalTokens = this.tokenCounter.countMessages(result);

    return result;
  }

  getState(): ContextState {
    return { ...this.state };
  }
}
```

### Summarizer

```typescript
// packages/core/src/context/summarizer.ts

interface SummaryStrategy {
  name: string;
  summarize(messages: Message[]): Promise<string>;
}

class LLMSummarizer implements SummaryStrategy {
  name = 'llm';
  private llmClient: LLMClient;

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient;
  }

  async summarize(messages: Message[]): Promise<string> {
    const transcript = this.formatTranscript(messages);

    const prompt = `Summarize this conversation transcript, preserving:
1. Key decisions made
2. Important technical details (file paths, code snippets, errors)
3. Current task/goal state
4. Any pending questions or blockers

Be concise but comprehensive. Format as structured notes.

Transcript:
${transcript}

Summary:`;

    const response = await this.llmClient.complete(prompt, {
      maxTokens: 2000,
      model: 'claude-3-haiku', // Use faster model for summaries
    });

    return response;
  }

  private formatTranscript(messages: Message[]): string {
    return messages.map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      let content = m.content;

      // Include tool calls/results
      if (m.toolCalls) {
        content += '\n[Tool calls: ' + m.toolCalls.map(t => t.name).join(', ') + ']';
      }

      return `${role}: ${content}`;
    }).join('\n\n');
  }
}

class HybridSummarizer implements SummaryStrategy {
  name = 'hybrid';
  private llmSummarizer: LLMSummarizer;

  async summarize(messages: Message[]): Promise<string> {
    // Extract key information programmatically
    const files = this.extractFilePaths(messages);
    const errors = this.extractErrors(messages);
    const commands = this.extractCommands(messages);

    // Get LLM summary for the rest
    const llmSummary = await this.llmSummarizer.summarize(messages);

    // Combine
    return `## Files Referenced
${files.join('\n')}

## Commands Executed
${commands.join('\n')}

## Errors Encountered
${errors.join('\n')}

## Conversation Summary
${llmSummary}`;
  }

  private extractFilePaths(messages: Message[]): string[] {
    const paths = new Set<string>();
    const pathRegex = /(?:\/[\w.-]+)+(?:\/[\w.-]+)*\.\w+/g;

    for (const msg of messages) {
      const matches = msg.content.match(pathRegex);
      if (matches) {
        matches.forEach(p => paths.add(p));
      }
    }

    return Array.from(paths);
  }

  // ... other extraction methods
}
```

## Implementation Steps

### Step 1: Add Token Counter
- [x] Add tiktoken dependency
- [x] Implement TokenCounter class
- [x] Add message counting
- [x] Test accuracy

**Files:**
- `package.json`
- `packages/core/src/context/token-counter.ts`

### Step 2: Implement Summarizer
- [x] Create Summarizer interface
- [x] Implement LLMSummarizer
- [x] Implement HybridSummarizer
- [x] Test summary quality

**Files:**
- `packages/core/src/context/summarizer.ts`

### Step 3: Implement Context Manager
- [x] Create ContextManager class
- [x] Add message processing
- [x] Implement summarization trigger
- [x] Add state tracking

**Files:**
- `packages/core/src/context/manager.ts`
- `packages/core/src/context/types.ts`

### Step 4: Integrate with Agent
- [x] Add ContextManager to AgentLoop
- [x] Process messages before LLM calls
- [x] Update UI with context status

**Files:**
- `packages/core/src/agent/loop.ts`
- `packages/core/src/client.ts`

### Step 5: Add Commands
- [x] Add /context command for status
- [x] Add /summarize command for manual trigger
- [x] Show token usage in status

**Files:**
- `packages/core/src/commands/builtin.ts`

### Step 6: Add Tests
- [x] Test token counting
- [x] Test summarization
- [x] Test context management
- [x] Test edge cases

**Files:**
- `packages/core/tests/context.test.ts`

## Testing Strategy

```typescript
describe('TokenCounter', () => {
  it('should count tokens accurately');
  it('should cache repeated strings');
  it('should handle tool calls in messages');
});

describe('Summarizer', () => {
  it('should preserve key information');
  it('should extract file paths');
  it('should handle long conversations');
});

describe('ContextManager', () => {
  it('should trigger at threshold');
  it('should preserve recent messages');
  it('should keep system prompt');
  it('should track state correctly');
});
```

## Rollout Plan

1. Add token counter
2. Implement summarizers
3. Build context manager
4. Integrate with agent
5. Add commands and UI
6. Monitor and tune thresholds

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Summary loses important info | High | Hybrid approach, keep recent messages |
| Token counting inaccuracy | Medium | Test against actual API usage |
| Summarization latency | Medium | Use faster model, async processing |
| Cost of summary LLM calls | Low | Use Haiku, batch when possible |

---


## Open Questions

- TBD
## Approval

- [x] Technical design approved
- [x] Implementation steps clear
- [x] Tests defined
- [x] Ready to implement

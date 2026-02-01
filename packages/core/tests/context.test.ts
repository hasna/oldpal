import { describe, expect, test } from 'bun:test';
import type { Message } from '@hasna/assistants-shared';
import type { LLMClient } from '../src/llm/client';
import { TokenCounter } from '../src/context/token-counter';
import { ContextManager } from '../src/context/manager';
import { LLMSummarizer } from '../src/context/summarizer';
import type { ContextConfig } from '../src/context/types';

class StubSummarizer {
  name = 'stub';
  async summarize(): Promise<string> {
    return 'summary';
  }
}

const baseConfig: ContextConfig = {
  enabled: true,
  maxContextTokens: 200,
  targetContextTokens: 150,
  summaryTriggerRatio: 0.5,
  keepRecentMessages: 2,
  keepSystemPrompt: true,
  summaryStrategy: 'llm',
  summaryMaxTokens: 200,
  maxMessages: 200,
};

describe('TokenCounter', () => {
  test('counts tokens consistently', () => {
    const counter = new TokenCounter();
    const count1 = counter.count('hello world');
    const count2 = counter.count('hello world');
    expect(count1).toBeGreaterThan(0);
    expect(count2).toBe(count1);
  });

  test('counts message tokens with tool calls', () => {
    const counter = new TokenCounter();
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'hello', timestamp: 0 },
      {
        id: '2',
        role: 'assistant',
        content: 'ok',
        timestamp: 0,
        toolCalls: [{ id: 't1', name: 'bash', input: { cmd: 'ls' } }],
      },
    ];

    const total = counter.countMessages(messages);
    expect(total).toBeGreaterThan(counter.count('hello'));
  });
});

describe('ContextManager', () => {
  test('summarizes when over threshold', async () => {
    const tokenCounter = new TokenCounter();
    const manager = new ContextManager(baseConfig, new StubSummarizer(), tokenCounter);

    const longText = 'hello '.repeat(50);
    const messages: Message[] = [
      { id: 's', role: 'system', content: 'system', timestamp: 0 },
      { id: '1', role: 'user', content: longText, timestamp: 0 },
      { id: '2', role: 'assistant', content: longText, timestamp: 0 },
      { id: '3', role: 'user', content: longText, timestamp: 0 },
      { id: '4', role: 'assistant', content: longText, timestamp: 0 },
    ];

    const result = await manager.processMessages(messages);
    expect(result.summarized).toBe(true);
    expect(result.summary).toBe('summary');
    expect(result.messages.some((msg) => msg.role === 'system' && msg.content.includes('Context Summary'))).toBe(true);
    expect(result.messages.slice(-1)[0].content).toBe(longText);
  });

  test('refreshState updates token counts without summarizing', () => {
    const tokenCounter = new TokenCounter();
    const manager = new ContextManager(baseConfig, new StubSummarizer(), tokenCounter);
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'hello', timestamp: 0 },
      { id: '2', role: 'assistant', content: 'world', timestamp: 0 },
    ];

    const state = manager.refreshState(messages);
    expect(state.messageCount).toBe(2);
    expect(state.totalTokens).toBeGreaterThan(0);
  });
});

describe('LLMSummarizer', () => {
  test('returns streamed summary text', async () => {
    const fakeClient: LLMClient = {
      getModel: () => 'test',
      async *chat() {
        yield { type: 'text', content: 'Summary text' };
        yield { type: 'done' };
      },
    };

    const summarizer = new LLMSummarizer(fakeClient, { maxTokens: 50 });
    const messages: Message[] = [{ id: '1', role: 'user', content: 'hello', timestamp: 0 }];
    const summary = await summarizer.summarize(messages);
    expect(summary).toBe('Summary text');
  });
});

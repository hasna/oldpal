import { describe, expect, test } from 'bun:test';
import type { LLMConfig } from '@oldpal/shared';
import { createLLMClient } from '../src/llm/client';

describe('createLLMClient', () => {
  test('returns anthropic client when provider is anthropic', async () => {
    const client = await createLLMClient({
      provider: 'anthropic',
      model: 'stub',
      apiKey: 'test-key',
    });
    expect(client.getModel()).toBe('stub');
  });

  test('throws for unsupported provider', async () => {
    await expect(
      createLLMClient({ provider: 'openai' as LLMConfig['provider'], model: 'gpt' })
    ).rejects.toThrow('Unsupported LLM provider');
  });
});

import type { Message } from '@oldpal/shared';
import { encoding_for_model, get_encoding, type Tiktoken } from 'tiktoken';

const DEFAULT_MODEL = 'gpt-4';
const MESSAGE_OVERHEAD_TOKENS = 4;

export class TokenCounter {
  private encoder: Tiktoken;
  private cache: Map<string, number> = new Map();
  private maxCacheEntries = 10000;

  constructor(model: string = DEFAULT_MODEL) {
    try {
      this.encoder = encoding_for_model(model);
    } catch {
      this.encoder = get_encoding('cl100k_base');
    }
  }

  count(text: string): number {
    if (!text) return 0;
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;

    const tokens = this.encoder.encode(text).length;

    if (text.length < 10000) {
      this.cache.set(text, tokens);
      if (this.cache.size > this.maxCacheEntries) {
        this.cache.clear();
      }
    }

    return tokens;
  }

  countMessages(messages: Message[]): number {
    let total = 0;

    for (const msg of messages) {
      total += MESSAGE_OVERHEAD_TOKENS;
      total += this.count(msg.content || '');

      if (msg.toolCalls) {
        for (const call of msg.toolCalls) {
          total += this.count(JSON.stringify(call));
        }
      }

      if (msg.toolResults) {
        for (const result of msg.toolResults) {
          total += this.count(JSON.stringify(result));
        }
      }
    }

    return total;
  }

  estimateResponse(prompt: string): number {
    return Math.floor(this.count(prompt) * 0.5);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

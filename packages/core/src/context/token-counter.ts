import type { Message } from '@hasna/assistants-shared';

const MESSAGE_OVERHEAD_TOKENS = 4;
const CHARS_PER_TOKEN = 4; // Rough estimate for fallback

// Lazy load tiktoken to handle missing wasm gracefully
let tiktokenEncoder: { encode: (text: string) => number[] } | null = null;
let tiktokenLoadAttempted = false;

function loadTiktoken(): typeof tiktokenEncoder {
  if (tiktokenLoadAttempted) return tiktokenEncoder;
  tiktokenLoadAttempted = true;

  try {
    // Dynamic import to catch wasm loading errors
    const tiktoken = require('tiktoken');
    try {
      tiktokenEncoder = tiktoken.encoding_for_model('gpt-4');
    } catch {
      tiktokenEncoder = tiktoken.get_encoding('cl100k_base');
    }
  } catch (error) {
    // Tiktoken wasm not available, will use fallback
    console.warn('Token counting using estimation (tiktoken unavailable)');
    tiktokenEncoder = null;
  }

  return tiktokenEncoder;
}

export class TokenCounter {
  private cache: Map<string, number> = new Map();
  private maxCacheEntries = 10000;

  constructor(_model?: string) {
    // Trigger lazy load
    loadTiktoken();
  }

  count(text: string): number {
    if (!text) return 0;
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;

    let tokens: number;
    const encoder = loadTiktoken();
    if (encoder) {
      tokens = encoder.encode(text).length;
    } else {
      // Fallback: estimate ~4 characters per token
      tokens = Math.ceil(text.length / CHARS_PER_TOKEN);
    }

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

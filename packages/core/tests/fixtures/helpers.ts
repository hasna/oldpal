import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Message } from '@hasna/assistants-shared';
import { generateId, now } from '@hasna/assistants-shared';

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'assistants-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createTestMessage(role: 'user' | 'assistant' | 'system', content: string): Message {
  return {
    id: generateId(),
    role,
    content,
    timestamp: now(),
  };
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 5000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Condition not met within timeout');
}

import { describe, expect, test } from 'bun:test';
import type { Message } from '@hasna/assistants-shared';
import { __test__ } from '../src/components/messageLines';

describe('message line estimation', () => {
  test('wraps long lines by width', () => {
    const msg: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: '1234567890',
      timestamp: 0,
    };
    expect(__test__.estimateMessageLines(msg, 5)).toBe(2);
  });

  test('ignores ANSI codes when wrapping', () => {
    const msg: Message = {
      id: 'msg-2',
      role: 'assistant',
      content: '\u001b[31m123456\u001b[0m',
      timestamp: 0,
    };
    expect(__test__.estimateMessageLines(msg, 3)).toBe(2);
  });
});

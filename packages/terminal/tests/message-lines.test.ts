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
    expect(__test__.estimateMessageLines(msg, 5)).toBe(4);
  });

  test('ignores ANSI codes when wrapping', () => {
    const msg: Message = {
      id: 'msg-2',
      role: 'assistant',
      content: '\u001b[31m123456\u001b[0m',
      timestamp: 0,
    };
    expect(__test__.estimateMessageLines(msg, 3)).toBe(4);
  });

  test('counts multi-line tool results', () => {
    const msg: Message = {
      id: 'msg-3',
      role: 'assistant',
      content: '',
      timestamp: 0,
      toolCalls: [
        { id: 'tool-1', name: 'bash', input: {}, type: 'tool' },
      ],
      toolResults: [
        {
          toolCallId: 'tool-1',
          toolName: 'bash',
          content: ['1', '2', '3', '4', '5', '6'].join('\n'),
          isError: false,
        },
      ],
    };
    expect(__test__.estimateMessageLines(msg)).toBe(13);
  });

  test('skips margin for continuation chunks', () => {
    const msg: Message = {
      id: 'msg-4::chunk-1',
      role: 'assistant',
      content: 'hello',
      timestamp: 0,
    };
    expect(__test__.estimateMessageLines(msg)).toBe(1);
  });

  test('counts activity entry lines with margin', () => {
    const entry = {
      type: 'text' as const,
      content: 'hello\nworld',
    };
    expect(__test__.estimateActivityEntryLines(entry, 80, 80)).toBe(4);
  });
});

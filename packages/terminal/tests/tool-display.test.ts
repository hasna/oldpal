import { describe, expect, test } from 'bun:test';
import type { ToolResult } from '@hasna/assistants-shared';
import { truncateToolResult } from '../src/components/toolDisplay';

function makeResult(overrides: Partial<ToolResult>): ToolResult {
  return {
    toolCallId: 'tool-1',
    toolName: 'bash',
    content: '',
    isError: false,
    ...overrides,
  };
}

describe('truncateToolResult', () => {
  test('returns verbose content with ansi stripped and tabs expanded', () => {
    const result = makeResult({
      content: 'ok',
      rawContent: '\u001b[31mHello\tWorld\u001b[0m',
    });
    const output = truncateToolResult(result, 15, 3000, { verbose: true });
    expect(output).toBe('Hello  World');
  });

  test('formats common error messages', () => {
    expect(truncateToolResult(makeResult({ isError: true, content: 'ENOENT: no such file' }))).toBe('⚠ File not found');
    expect(truncateToolResult(makeResult({ isError: true, content: 'EACCES permission denied' }))).toBe('⚠ Permission denied');
    expect(truncateToolResult(makeResult({ isError: true, content: 'ETIMEDOUT: timeout' }))).toBe('⚠ Request timed out');
  });

  test('formats schedule results', () => {
    const res = (content: string) =>
      truncateToolResult(makeResult({ toolName: 'schedule', content }));
    expect(res('No schedules found.')).toBe('📅 No scheduled tasks');
    expect(res('Scheduled task created.')).toBe('✓ Schedule created');
    expect(res('Removed schedule')).toBe('✓ Schedule deleted');
    expect(res('Paused schedule')).toBe('⏸ Schedule paused');
    expect(res('Resumed schedule')).toBe('▶ Schedule resumed');
    expect(res('id: 1\ncommand: echo')).toBe('📅 2 scheduled tasks');
  });

  test('formats feedback results', () => {
    const output = truncateToolResult(makeResult({ toolName: 'submit_feedback', content: 'submitted' }));
    expect(output).toBe('✓ Feedback submitted');
  });

  test('formats read/write/glob/grep/bash/search results', () => {
    const readOutput = truncateToolResult(makeResult({ toolName: 'read', content: Array.from({ length: 25 }, (_, i) => String(i)).join('\n') }));
    expect(readOutput).toBe('📄 Read 25 lines');

    const writeOutput = truncateToolResult(makeResult({ toolName: 'write', content: 'saved file' }));
    expect(writeOutput).toBe('✓ File saved');

    const globEmpty = truncateToolResult(makeResult({ toolName: 'glob', content: '' }));
    expect(globEmpty).toBe('🔍 No files found');
    const globMany = truncateToolResult(makeResult({ toolName: 'glob', content: Array.from({ length: 11 }, (_, i) => `file-${i}`).join('\n') }));
    expect(globMany).toBe('🔍 Found 11 files');

    const grepEmpty = truncateToolResult(makeResult({ toolName: 'grep', content: '\n\n' }));
    expect(grepEmpty).toBe('🔍 No matches found');
    const grepMany = truncateToolResult(makeResult({ toolName: 'grep', content: Array.from({ length: 12 }, (_, i) => `match-${i}`).join('\n') }));
    expect(grepMany).toBe('🔍 Found 12 matches');

    const bashEmpty = truncateToolResult(makeResult({ toolName: 'bash', content: '' }));
    expect(bashEmpty).toBe('✓ Command completed');
    const bashShort = truncateToolResult(makeResult({ toolName: 'bash', content: 'ok' }));
    expect(bashShort).toBe('ok');
    const bashLong = truncateToolResult(makeResult({ toolName: 'bash', content: Array.from({ length: 25 }, (_, i) => `line-${i}`).join('\n') }));
    expect(bashLong).toBe('✓ Output: 25 lines');

    const searchOutput = truncateToolResult(makeResult({ toolName: 'web_search', content: 'https://example.com\nhttps://test.com' }));
    expect(searchOutput).toBe('🔍 Found 2 results');
  });

  test('falls back to raw content when formatter returns null', () => {
    expect(truncateToolResult(makeResult({ toolName: 'unknown', content: 'raw' }))).toBe('raw');
    expect(truncateToolResult(makeResult({ toolName: 'schedule', content: 'neutral message' }))).toBe('neutral message');
    expect(truncateToolResult(makeResult({ toolName: 'submit_feedback', content: 'ok' }))).toBe('ok');
    expect(truncateToolResult(makeResult({ toolName: 'read', content: 'short\nfile' }))).toBe('short\nfile');
    expect(truncateToolResult(makeResult({ toolName: 'write', content: 'noop' }))).toBe('noop');
    expect(truncateToolResult(makeResult({ toolName: 'glob', content: 'a.txt\nb.txt' }))).toBe('a.txt\nb.txt');
    expect(truncateToolResult(makeResult({ toolName: 'grep', content: 'match' }))).toBe('match');
    expect(truncateToolResult(makeResult({ toolName: 'web_search', content: 'no urls' }))).toBe('no urls');
  });

  test('falls back to truncation with prefix for errors', () => {
    const content = Array.from({ length: 5 }, (_, i) => `line-${i}`).join('\n');
    const output = truncateToolResult(makeResult({ toolName: 'unknown', content, isError: true }), 3, 20);
    expect(output.startsWith('Error:')).toBe(true);
    expect(output).toContain('...');
  });
});

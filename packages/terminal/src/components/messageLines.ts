import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';
import { renderMarkdown } from './Markdown';
import { truncateToolResult } from './toolDisplay';

export type DisplayMessage = Message & { __rendered?: boolean; __lineCount?: number };

export interface ActivityEntryLike {
  type: 'text' | 'tool_call' | 'tool_result';
  content?: string;
  toolResult?: ToolResult;
}

function estimateToolPanelLines(
  toolCalls: ToolCall[],
  toolResults?: ToolResult[],
  hasContent?: boolean
): number {
  if (!toolCalls || toolCalls.length === 0) {
    return 0;
  }

  const resultLines = new Map<string, number>();
  for (const result of toolResults || []) {
    resultLines.set(result.toolCallId, estimateToolResultLines(result));
  }

  // Ink borders add top + bottom lines, plus a header line.
  let lines = 3;
  if (hasContent) {
    // Margin between text and panel.
    lines += 1;
  }

  for (const call of toolCalls) {
    // marginTop + name line + summary line
    lines += 3;
    const toolResultLines = resultLines.get(call.id);
    if (toolResultLines && toolResultLines > 0) {
      lines += toolResultLines;
    }
  }

  return lines;
}

function estimateToolResultLines(result: ToolResult, maxLines = 4): number {
  const content = truncateToolResult(result, maxLines, 400);
  if (!content) return 1;
  const lines = stripAnsi(content).split('\n');
  return Math.max(1, lines.length);
}

export function estimateMessageLines(message: DisplayMessage, maxWidth?: number): number {
  if (message.role === 'system') {
    return 0;
  }

  const content = message.content ?? '';
  const contentLines = content.length > 0 ? content.split('\n') : [];
  const hasContent = contentLines.length > 0;
  const prefixWidth = message.role === 'user' || message.role === 'assistant' ? 2 : 0;
  const effectiveWidth = maxWidth ? Math.max(1, maxWidth - prefixWidth) : maxWidth;
  const wrappedLines =
    typeof message.__lineCount === 'number'
      ? message.__lineCount
      : contentLines.length > 0
        ? countWrappedLines(contentLines, effectiveWidth)
        : 0;
  let lines = hasContent ? Math.max(1, wrappedLines) : 0;

  if (message.role === 'assistant' && message.toolCalls?.length) {
    lines += estimateToolPanelLines(message.toolCalls, message.toolResults, hasContent);
  }

  if (message.role === 'user' || message.role === 'assistant') {
    if (!isContinuationChunk(message.id)) {
      // marginY=1 adds two empty lines
      lines += 2;
    }
  }

  return lines;
}

function countWrappedLines(lines: string[], maxWidth?: number): number {
  if (!maxWidth || maxWidth <= 0) {
    return lines.length;
  }
  let total = 0;
  for (const line of lines) {
    const visible = stripAnsi(line).length;
    const wrapped = Math.max(1, Math.ceil(visible / maxWidth));
    total += wrapped;
  }
  return total;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

export function estimateActivityEntryLines(
  entry: ActivityEntryLike,
  wrapWidth: number,
  renderWidth?: number
): number {
  const effectiveWidth = Math.max(1, wrapWidth - 2);
  if (entry.type === 'text') {
    const content = entry.content ?? '';
    if (!content.trim()) return 0;
    const rendered = renderMarkdown(content, { maxWidth: renderWidth });
    const lines = stripAnsi(rendered).split('\n');
    const wrapped = countWrappedLines(lines, effectiveWidth);
    return Math.max(1, wrapped) + 2; // marginY=1
  }

  if (entry.type === 'tool_call') {
    // Two lines (call + elapsed) + marginY=1
    return 4;
  }

  if (entry.type === 'tool_result') {
    const content = entry.toolResult ? truncateToolResult(entry.toolResult) : '';
    const lines = content.split('\n');
    const wrapped = countWrappedLines(lines, effectiveWidth);
    return Math.max(1, wrapped) + 2; // marginY=1
  }

  return 0;
}

export function estimateActivityLogLines(
  entries: ActivityEntryLike[],
  wrapWidth: number,
  renderWidth?: number
): number {
  return entries.reduce((sum, entry) => sum + estimateActivityEntryLines(entry, wrapWidth, renderWidth), 0);
}

function isContinuationChunk(id: string): boolean {
  const match = id.match(/::chunk-(\d+)$/);
  if (!match) return false;
  const idx = Number(match[1]);
  return Number.isFinite(idx) && idx > 0;
}

export const __test__ = {
  estimateMessageLines,
  estimateActivityEntryLines,
};

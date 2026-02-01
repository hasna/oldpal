import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';

export type DisplayMessage = Message & { __rendered?: boolean };

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
  const content = String(result.content || '');
  if (!content) return 1;
  const lines = content.replace(/\x1B\[[0-9;]*m/g, '').split('\n');
  if (lines.length <= maxLines) return Math.max(1, lines.length);
  return maxLines + 1; // include truncation line
}

export function estimateMessageLines(message: DisplayMessage, maxWidth?: number): number {
  if (message.role === 'system') {
    return 0;
  }

  const content = message.content ?? '';
  const contentLines = content.length > 0 ? content.split('\n') : [];
  const hasContent = contentLines.length > 0;
  const wrappedLines = contentLines.length > 0 ? countWrappedLines(contentLines, maxWidth) : 0;
  let lines = hasContent ? Math.max(1, wrappedLines) : 0;

  if (message.role === 'assistant' && message.toolCalls?.length) {
    lines += estimateToolPanelLines(message.toolCalls, message.toolResults, hasContent);
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

export const __test__ = {
  estimateMessageLines,
};

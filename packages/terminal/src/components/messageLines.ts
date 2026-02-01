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

  const resultMap = new Set<string>();
  for (const result of toolResults || []) {
    resultMap.add(result.toolCallId);
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
    if (resultMap.has(call.id)) {
      // result line
      lines += 1;
    }
  }

  return lines;
}

export function estimateMessageLines(message: DisplayMessage): number {
  if (message.role === 'system') {
    return 0;
  }

  const content = message.content ?? '';
  const contentLines = content.length > 0 ? content.split('\n').length : 0;
  const hasContent = contentLines > 0;
  let lines = Math.max(1, contentLines);

  if (message.role === 'assistant' && message.toolCalls?.length) {
    lines += estimateToolPanelLines(message.toolCalls, message.toolResults, hasContent);
  }

  return lines;
}

export const __test__ = {
  estimateMessageLines,
};

import React from 'react';
import { Box, Text } from 'ink';
import type { Message, ToolCall, ToolResult } from '@oldpal/shared';
import { Markdown } from './Markdown';

interface ActivityEntry {
  id: string;
  type: 'text' | 'tool_call' | 'tool_result';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  timestamp: number;
}

interface MessagesProps {
  messages: Message[];
  currentResponse?: string;
  currentToolCall?: ToolCall;
  lastToolResult?: ToolResult;
  activityLog?: ActivityEntry[];
  scrollOffset?: number;
  maxVisible?: number;
  queuedMessageIds?: Set<string>;
}

export function Messages({
  messages,
  currentResponse,
  currentToolCall,
  lastToolResult,
  activityLog = [],
  scrollOffset = 0,
  maxVisible = 10,
  queuedMessageIds,
}: MessagesProps) {
  // Calculate visible messages based on scroll offset
  // scrollOffset 0 means showing the latest messages
  const endIndex = messages.length - scrollOffset;
  const startIndex = Math.max(0, endIndex - maxVisible);
  const visibleMessages = messages.slice(startIndex, endIndex);

  // Group consecutive tool-only assistant messages
  const groupedMessages = groupConsecutiveToolMessages(visibleMessages);

  // Separate historical messages (stable) from current activity (dynamic)
  // Historical messages use Static to prevent re-rendering and "eating"
  const historicalItems = groupedMessages.map((group) => {
    if (group.type === 'single') {
      return { id: group.message.id, group };
    }
    return { id: group.messages[0].id, group };
  });

  return (
    <Box flexDirection="column">
      {/* Historical messages */}
      {historicalItems.map((item) => {
        if (item.group.type === 'single') {
          return <MessageBubble key={item.id} message={item.group.message} queuedMessageIds={queuedMessageIds} />;
        }
        return <CombinedToolMessage key={item.id} messages={item.group.messages} />;
      })}

      {/* Show activity log - text, tool calls, and tool results */}
      {activityLog.map((entry) => {
        if (entry.type === 'text' && entry.content) {
          return (
            <Box key={entry.id} marginY={1}>
              <Text dimColor>● </Text>
              <Box flexGrow={1}>
                <Markdown content={entry.content} />
              </Box>
            </Box>
          );
        }
        if (entry.type === 'tool_call' && entry.toolCall) {
          return (
            <Box key={entry.id} marginY={1}>
              <Text dimColor>⚙ </Text>
              <Text dimColor>{formatToolCall(entry.toolCall)}</Text>
            </Box>
          );
        }
        if (entry.type === 'tool_result' && entry.toolResult) {
          const output = truncateToolResult(entry.toolResult);
          return (
            <Box key={entry.id} marginY={1}>
              <Text dimColor>↳ </Text>
              <Box flexGrow={1}>
                <Text dimColor>{output}</Text>
              </Box>
            </Box>
          );
        }
        return null;
      })}

      {/* Show current streaming response (text being typed now) */}
      {currentResponse && (
        <Box marginY={1}>
          <Text dimColor>● </Text>
          <Box flexGrow={1}>
            <Markdown content={currentResponse} />
          </Box>
        </Box>
      )}
    </Box>
  );
}

type MessageGroup =
  | { type: 'single'; message: Message }
  | { type: 'grouped'; messages: Message[] };

/**
 * Group consecutive assistant messages that only have tool calls (no text content)
 */
function groupConsecutiveToolMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentToolGroup: Message[] = [];

  for (const msg of messages) {
    const isToolOnlyAssistant =
      msg.role === 'assistant' &&
      (!msg.content || !msg.content.trim()) &&
      msg.toolCalls &&
      msg.toolCalls.length > 0;

    if (isToolOnlyAssistant) {
      currentToolGroup.push(msg);
    } else {
      // Flush any accumulated tool messages
      if (currentToolGroup.length > 0) {
        if (currentToolGroup.length === 1) {
          groups.push({ type: 'single', message: currentToolGroup[0] });
        } else {
          groups.push({ type: 'grouped', messages: currentToolGroup });
        }
        currentToolGroup = [];
      }
      groups.push({ type: 'single', message: msg });
    }
  }

  // Flush remaining tool messages
  if (currentToolGroup.length > 0) {
    if (currentToolGroup.length === 1) {
      groups.push({ type: 'single', message: currentToolGroup[0] });
    } else {
      groups.push({ type: 'grouped', messages: currentToolGroup });
    }
  }

  return groups;
}

/**
 * Render multiple tool-only messages as a single combined row
 */
function CombinedToolMessage({ messages }: { messages: Message[] }) {
  // Collect all tool calls from all messages
  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];
  for (const msg of messages) {
    if (msg.toolCalls) {
      allToolCalls.push(...msg.toolCalls);
    }
    if (msg.toolResults) {
      allToolResults.push(...msg.toolResults);
    }
  }

  return (
    <ToolCallPanel toolCalls={allToolCalls} toolResults={allToolResults} />
  );
}

interface MessageBubbleProps {
  message: Message;
  queuedMessageIds?: Set<string>;
}

function MessageBubble({ message, queuedMessageIds }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isQueued = isUser && queuedMessageIds?.has(message.id);

  if (isSystem) {
    return null;
  }

  if (isUser) {
    return (
      <Box marginY={1}>
        <Text dimColor>❯ </Text>
        {isQueued ? (
          <Text dimColor>⏳ {message.content}</Text>
        ) : (
          <Text>{message.content}</Text>
        )}
      </Box>
    );
  }

  // Assistant message
  const toolCalls = message.toolCalls || [];
  const toolResults = message.toolResults || [];
  const hasContent = message.content && message.content.trim();

  return (
    <Box marginY={1} flexDirection="column">
      {hasContent && (
        <Box>
          <Text dimColor>● </Text>
          <Box flexGrow={1}>
            <Markdown content={message.content} />
          </Box>
        </Box>
      )}
      {toolCalls.length > 0 && (
        <Box marginLeft={hasContent ? 2 : 0} marginTop={hasContent ? 1 : 0}>
          <ToolCallPanel toolCalls={toolCalls} toolResults={toolResults} />
        </Box>
      )}
    </Box>
  );
}

function ToolCallPanel({
  toolCalls,
  toolResults,
}: {
  toolCalls: ToolCall[];
  toolResults?: ToolResult[];
}) {
  if (toolCalls.length === 0) return null;

  const resultMap = new Map<string, ToolResult>();
  for (const result of toolResults || []) {
    resultMap.set(result.toolCallId, result);
  }

  const hasError = toolCalls.some((toolCall) => resultMap.get(toolCall.id)?.isError);
  const allComplete = toolCalls.every((toolCall) => resultMap.has(toolCall.id));
  const borderColor = hasError ? 'red' : allComplete ? 'green' : 'yellow';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={borderColor} bold>Tool Calls</Text>
        <Text dimColor>
          {toolCalls.length} {allComplete ? 'done' : 'running'}
        </Text>
      </Box>
      {toolCalls.map((toolCall) => {
        const result = resultMap.get(toolCall.id);
        const statusIcon = result ? (result.isError ? '✗' : '✓') : '◐';
        const statusColor = result ? (result.isError ? 'red' : 'green') : 'yellow';
        const displayName = getToolDisplayName(toolCall);
        const context = getToolContext(toolCall);
        return (
          <Box key={toolCall.id} flexDirection="column" marginTop={1}>
            <Box>
              <Text color={statusColor}>{statusIcon} </Text>
              <Text color={statusColor} bold>{displayName}</Text>
              {context && <Text dimColor> · {context}</Text>}
            </Box>
            <Text dimColor>{formatToolCall(toolCall)}</Text>
            {result && (
              <Box marginLeft={2}>
                <Text dimColor>↳ {truncateToolResult(result, 4, 400)}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Generate a brief summary of tool calls with descriptive blurbs
 */
function getToolSummary(toolCalls: ToolCall[]): string {
  if (toolCalls.length === 0) return '';

  // For single tool call, show descriptive blurb
  if (toolCalls.length === 1) {
    return `[${formatToolCall(toolCalls[0])}]`;
  }

  // For multiple tool calls, group by type and show count with first item's context
  const toolGroups: Record<string, { count: number; firstCall: ToolCall }> = {};
  for (const tc of toolCalls) {
    const name = getToolDisplayName(tc);
    if (!toolGroups[name]) {
      toolGroups[name] = { count: 1, firstCall: tc };
    } else {
      toolGroups[name].count++;
    }
  }

  // Build summary string with context
  const parts: string[] = [];
  for (const [name, { count, firstCall }] of Object.entries(toolGroups)) {
    if (count > 1) {
      // Show abbreviated context for multiple calls
      const context = getToolContext(firstCall);
      parts.push(context ? `${name} ×${count} (${context}, ...)` : `${name} ×${count}`);
    } else {
      parts.push(formatToolCall(firstCall));
    }
  }

  return `[${parts.join(', ')}]`;
}

/**
 * Get short context from tool call input
 */
function getToolContext(toolCall: ToolCall): string {
  const { name, input } = toolCall;
  switch (name) {
    case 'bash':
      return truncate(String(input.command || ''), 20);
    case 'read':
      const path = String(input.path || input.file_path || '');
      return path.split('/').pop() || '';
    case 'write':
      const writePath = String(input.filename || input.path || input.file_path || '');
      return writePath.split('/').pop() || '';
    case 'glob':
      return truncate(String(input.pattern || ''), 20);
    case 'grep':
      return truncate(String(input.pattern || ''), 20);
    default:
      return '';
  }
}

/**
 * Get display name for a tool call
 */
function getToolDisplayName(toolCall: ToolCall): string {
  const { name, input } = toolCall;

  switch (name) {
    case 'bash':
      return 'bash';
    case 'curl':
    case 'web_fetch':
      return 'fetch';
    case 'web_search':
      return 'search';
    case 'read':
      return 'read';
    case 'write':
      return 'write';
    case 'glob':
      return 'glob';
    case 'grep':
      return 'grep';
    case 'display_image':
      return 'image';
    case 'notion':
    case 'gmail':
    case 'googledrive':
    case 'googlecalendar':
    case 'linear':
    case 'slack':
      return name;
    default:
      return name;
  }
}

function formatToolCall(toolCall: ToolCall): string {
  const { name, input } = toolCall;

  switch (name) {
    case 'bash':
      return `Running: ${truncate(String(input.command || ''), 60)}`;
    case 'curl':
      return `Fetching: ${truncate(String(input.url || ''), 60)}`;
    case 'web_fetch':
      return `Fetching: ${truncate(String(input.url || ''), 60)}`;
    case 'web_search':
      return `Searching: ${truncate(String(input.query || ''), 60)}`;
    case 'read':
      return `Reading: ${truncate(String(input.path || input.file_path || ''), 60)}`;
    case 'write':
      return `Writing: ${truncate(String(input.filename || input.path || input.file_path || ''), 60)}`;
    case 'glob':
      return `Finding: ${truncate(String(input.pattern || ''), 60)}`;
    case 'grep':
      return `Searching: ${truncate(String(input.pattern || ''), 60)}`;
    case 'notion':
      return `Notion: ${truncate(String(input.command || input.action || ''), 60)}`;
    case 'gmail':
      return `Gmail: ${truncate(String(input.command || input.action || ''), 60)}`;
    case 'googledrive':
      return `Drive: ${truncate(String(input.command || input.action || ''), 60)}`;
    case 'googlecalendar':
      return `Calendar: ${truncate(String(input.command || input.action || ''), 60)}`;
    case 'linear':
      return `Linear: ${truncate(String(input.command || input.action || ''), 60)}`;
    case 'slack':
      return `Slack: ${truncate(String(input.command || input.action || ''), 60)}`;
    default:
      return `${name}: ${truncate(JSON.stringify(input), 50)}`;
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Truncate tool result for display - keeps it readable
 */
function truncateToolResult(toolResult: ToolResult, maxLines = 15, maxChars = 3000): string {
  const toolName = toolResult.toolName || 'tool';
  const prefix = toolResult.isError ? `Error from ${toolName}: ` : `${toolName}: `;

  let content = String(toolResult.content || '');

  // Strip ANSI codes
  content = content.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

  // Replace tabs with spaces
  content = content.replace(/\t/g, '  ');

  // Truncate by lines first
  const lines = content.split('\n');
  if (lines.length > maxLines) {
    content = lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
  }

  // Then truncate by chars
  if (content.length > maxChars) {
    content = content.slice(0, maxChars) + '...';
  }

  return prefix + content.trim();
}

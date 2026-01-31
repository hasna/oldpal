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
}

export function Messages({ messages, currentResponse, currentToolCall, lastToolResult, activityLog = [] }: MessagesProps) {
  // Only show last 10 messages to avoid terminal overflow
  const visibleMessages = messages.slice(-10);

  return (
    <Box flexDirection="column">
      {visibleMessages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}

      {/* Show activity log - interleaved text, tool calls, and results */}
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
            <Box key={entry.id} marginTop={1}>
              <Text dimColor>  ◐ {formatToolCall(entry.toolCall)}</Text>
            </Box>
          );
        }
        if (entry.type === 'tool_result' && entry.toolResult) {
          return (
            <Box key={entry.id} marginBottom={1}>
              <Text dimColor>  → {truncate(entry.toolResult.content, 80)}</Text>
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

      {/* Show current tool call being executed */}
      {currentToolCall && (
        <Box marginTop={1}>
          <Text dimColor>  ◐ {formatToolCall(currentToolCall)}</Text>
        </Box>
      )}
    </Box>
  );
}

interface MessageBubbleProps {
  message: Message;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return null;
  }

  if (isUser) {
    return (
      <Box marginY={1}>
        <Text dimColor>❯ </Text>
        <Text>{message.content}</Text>
      </Box>
    );
  }

  // Assistant message
  return (
    <Box marginY={1} flexDirection="column">
      <Box>
        <Text dimColor>● </Text>
        <Box flexGrow={1}>
          <Markdown content={message.content} />
        </Box>
      </Box>

      {/* Show tool calls in this message */}
      {message.toolCalls?.map((toolCall) => (
        <Box key={toolCall.id} marginLeft={2} marginTop={1}>
          <Text dimColor>◐ {formatToolCall(toolCall)}</Text>
        </Box>
      ))}
    </Box>
  );
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
      return `Writing: ${truncate(String(input.path || input.file_path || ''), 60)}`;
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

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ToolCall, ToolResult } from '@oldpal/shared';

interface ToolCallEntry {
  toolCall: ToolCall;
  result?: ToolResult;
}

interface ToolCallBoxProps {
  entries: ToolCallEntry[];
  maxVisible?: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function ToolCallBox({
  entries,
  maxVisible = 3,
  isExpanded = false,
  onToggleExpand,
}: ToolCallBoxProps) {
  if (entries.length === 0) {
    return null;
  }

  const visibleEntries = isExpanded ? entries : entries.slice(-maxVisible);
  const hiddenCount = entries.length - visibleEntries.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginY={1}
    >
      {/* Header with expand hint */}
      <Box justifyContent="space-between">
        <Text dimColor bold>
          Tools ({entries.length})
        </Text>
        {entries.length > maxVisible && (
          <Text dimColor>
            {isExpanded ? 'Ctrl+O to collapse' : 'Ctrl+O to expand'}
          </Text>
        )}
      </Box>

      {/* Hidden count indicator */}
      {hiddenCount > 0 && !isExpanded && (
        <Text dimColor>  +{hiddenCount} more above...</Text>
      )}

      {/* Visible tool calls */}
      {visibleEntries.map((entry, index) => (
        <ToolCallRow key={entry.toolCall.id} entry={entry} />
      ))}
    </Box>
  );
}

interface ToolCallRowProps {
  entry: ToolCallEntry;
}

function ToolCallRow({ entry }: ToolCallRowProps) {
  const { toolCall, result } = entry;
  const statusIcon = result ? (result.isError ? '✗' : '✓') : '◐';
  const statusColor = result ? (result.isError ? 'red' : 'green') : 'yellow';

  return (
    <Box>
      <Text color={statusColor}>{statusIcon} </Text>
      <Text dimColor>{formatToolCall(toolCall)}</Text>
    </Box>
  );
}

function formatToolCall(toolCall: ToolCall): string {
  const { name, input } = toolCall;

  switch (name) {
    case 'bash':
      return `bash: ${truncate(String(input.command || ''), 50)}`;
    case 'curl':
    case 'web_fetch':
      return `fetch: ${truncate(String(input.url || ''), 50)}`;
    case 'web_search':
      return `search: ${truncate(String(input.query || ''), 50)}`;
    case 'read':
      return `read: ${truncate(String(input.path || input.file_path || ''), 50)}`;
    case 'write':
      return `write: ${truncate(String(input.filename || input.path || input.file_path || ''), 50)}`;
    case 'glob':
      return `glob: ${truncate(String(input.pattern || ''), 50)}`;
    case 'grep':
      return `grep: ${truncate(String(input.pattern || ''), 50)}`;
    case 'notion':
      return `notion: ${truncate(String(input.command || input.action || ''), 50)}`;
    case 'gmail':
      return `gmail: ${truncate(String(input.command || input.action || ''), 50)}`;
    case 'googledrive':
      return `drive: ${truncate(String(input.command || input.action || ''), 50)}`;
    case 'googlecalendar':
      return `calendar: ${truncate(String(input.command || input.action || ''), 50)}`;
    case 'linear':
      return `linear: ${truncate(String(input.command || input.action || ''), 50)}`;
    case 'slack':
      return `slack: ${truncate(String(input.command || input.action || ''), 50)}`;
    default:
      return `${name}: ${truncate(JSON.stringify(input), 40)}`;
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

// Hook for handling Ctrl+O expansion
export function useToolCallExpansion() {
  const [isExpanded, setIsExpanded] = useState(false);

  useInput((input, key) => {
    if (key.ctrl && input === 'o') {
      setIsExpanded((prev) => !prev);
    }
  });

  return { isExpanded, setIsExpanded };
}

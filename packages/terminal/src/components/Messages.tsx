import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';
import { Markdown } from './Markdown';
import {
  groupConsecutiveToolMessages,
  type DisplayMessage,
} from './messageLines';
import { truncateToolResult } from './toolDisplay';
import { basename } from 'path';

interface ActivityEntry {
  id: string;
  type: 'text' | 'tool_call' | 'tool_result';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  timestamp: number;
}

interface MessagesProps {
  messages: DisplayMessage[];
  currentResponse?: string;
  streamingMessages?: DisplayMessage[];
  currentToolCall?: ToolCall;
  lastToolResult?: ToolResult;
  activityLog?: ActivityEntry[];
  queuedMessageIds?: Set<string>;
  verboseTools?: boolean;
}

export function Messages({
  messages,
  currentResponse,
  streamingMessages = [],
  currentToolCall,
  lastToolResult,
  activityLog = [],
  queuedMessageIds,
  verboseTools = false,
}: MessagesProps) {
  const [now, setNow] = useState(Date.now());

  type MessageItem =
    | { kind: 'message'; message: DisplayMessage }
    | { kind: 'grouped'; messages: DisplayMessage[] };

  type Item = MessageItem
    | { kind: 'activity'; entry: ActivityEntry }
    | { kind: 'streaming'; message: DisplayMessage };

  const messageGroups = useMemo(() => groupConsecutiveToolMessages(messages), [messages]);
  const messageItems = useMemo<MessageItem[]>(() => {
    return messageGroups.map((group) => (
      group.type === 'single'
        ? { kind: 'message', message: group.message }
        : { kind: 'grouped', messages: group.messages }
    ));
  }, [messageGroups]);

  const visibleMessageItems = messageItems;
  const visibleActivity = activityLog;
  const visibleStreaming = streamingMessages;
  const showCurrentResponse = Boolean(currentResponse) && streamingMessages.length === 0;

  // Separate historical messages (stable) from current activity (dynamic)
  const historicalItems = visibleMessageItems.map((item) => {
    if (item.kind === 'message') {
      return { id: item.message.id, item };
    }
    return { id: item.messages[0].id, item };
  });

  const toolResultMap = useMemo(() => {
    const map = new Map<string, ActivityEntry>();
    for (const entry of activityLog) {
      if (entry.type === 'tool_result' && entry.toolResult) {
        map.set(entry.toolResult.toolCallId, entry);
      }
    }
    return map;
  }, [activityLog]);

  const hasPendingTools = useMemo(() => {
    for (const entry of activityLog) {
      if (entry.type === 'tool_call' && entry.toolCall) {
        if (!toolResultMap.has(entry.toolCall.id)) {
          return true;
        }
      }
    }
    return false;
  }, [activityLog, toolResultMap]);

  useEffect(() => {
    if (!hasPendingTools) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [hasPendingTools]);

  return (
    <Box flexDirection="column" width="100%">
      {/* Historical messages */}
      {historicalItems.map((item) => {
        if (item.item.kind === 'message') {
          return (
            <MessageBubble
              key={item.id}
              message={item.item.message}
              queuedMessageIds={queuedMessageIds}
              verboseTools={verboseTools}
            />
          );
        }
        return <CombinedToolMessage key={item.id} messages={item.item.messages} verboseTools={verboseTools} />;
      })}

      {/* Show activity log - text, tool calls, and tool results */}
      {visibleActivity.map((entry) => {
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
          const resultEntry = toolResultMap.get(entry.toolCall.id);
          const elapsedMs = (resultEntry ? resultEntry.timestamp : now) - entry.timestamp;
          const elapsedText = formatDuration(elapsedMs);
          return (
            <Box key={entry.id} marginY={1} flexDirection="column">
              <Box>
                <Text dimColor>⚙ </Text>
                <Text dimColor>{formatToolCall(entry.toolCall)}</Text>
              </Box>
              <Box marginLeft={2}>
                <Text dimColor>{elapsedText} elapsed</Text>
              </Box>
            </Box>
          );
        }
        if (entry.type === 'tool_result' && entry.toolResult) {
          const output = truncateToolResult(entry.toolResult, undefined, undefined, { verbose: verboseTools });
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

      {visibleStreaming.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          queuedMessageIds={queuedMessageIds}
          verboseTools={verboseTools}
        />
      ))}

      {/* Show current streaming response (text being typed now) */}
      {showCurrentResponse && (
        <Box marginY={1}>
          <Text dimColor>● </Text>
          <Box flexGrow={1}>
            <Markdown content={currentResponse ?? ''} />
          </Box>
        </Box>
      )}
    </Box>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

/**
 * Render multiple tool-only messages as a single combined row
 */
function CombinedToolMessage({ messages, verboseTools }: { messages: DisplayMessage[]; verboseTools?: boolean }) {
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
    <Box marginY={1}>
      <ToolCallPanel toolCalls={allToolCalls} toolResults={allToolResults} verboseTools={verboseTools} />
    </Box>
  );
}


interface MessageBubbleProps {
  message: DisplayMessage;
  queuedMessageIds?: Set<string>;
  verboseTools?: boolean;
}

function MessageBubble({ message, queuedMessageIds, verboseTools }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isQueued = isUser && queuedMessageIds?.has(message.id);
  const chunkMatch = message.id.match(/::chunk-(\d+)$/);
  const chunkIndex = chunkMatch ? Number(chunkMatch[1]) : -1;
  const isContinuation = chunkIndex > 0;
  const content = message.content ?? '';
  const leadingBullet = !isContinuation && !startsWithListOrTable(content);

  if (isSystem) {
    return null;
  }

  if (isUser) {
    const toolResults = message.toolResults || [];
    const showToolResultsOnly = toolResults.length > 0 && !isContinuation;
    const hasContent = Boolean((message.content ?? '').trim());
    return (
      <Box marginY={isContinuation ? 0 : 1} flexDirection="column">
        {hasContent && (
          <Box>
            <Text dimColor>{isContinuation ? '  ' : '❯ '} </Text>
            {isQueued && !isContinuation ? (
              <Text dimColor>⏳ {message.content ?? ''}</Text>
            ) : (
              <Text>{message.content ?? ''}</Text>
            )}
          </Box>
        )}
        {showToolResultsOnly && (
          <Box marginTop={hasContent ? 1 : 0}>
            <ToolResultPanel toolResults={toolResults} verboseTools={verboseTools} />
          </Box>
        )}
      </Box>
    );
  }

  // Assistant message
  const toolCalls = message.toolCalls || [];
  const toolResults = message.toolResults || [];
  const hasContent = content && content.trim();
  const showToolResultsOnly = toolCalls.length === 0 && toolResults.length > 0;

  return (
    <Box marginY={isContinuation ? 0 : 1} flexDirection="column">
      {hasContent && (
        <Box>
          <Text dimColor>{isContinuation || !leadingBullet ? '  ' : '● '} </Text>
          <Box flexGrow={1}>
            <Markdown content={message.content} preRendered={Boolean(message.__rendered)} />
          </Box>
        </Box>
      )}
      {toolCalls.length > 0 && (
        <Box marginTop={hasContent ? 1 : 0}>
          <ToolCallPanel toolCalls={toolCalls} toolResults={toolResults} verboseTools={verboseTools} />
        </Box>
      )}
      {showToolResultsOnly && (
        <Box marginTop={hasContent ? 1 : 0}>
          <ToolResultPanel toolResults={toolResults} verboseTools={verboseTools} />
        </Box>
      )}
    </Box>
  );
}

function startsWithListOrTable(content: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = stripAnsi(line).trimStart();
    if (!trimmed) continue;
    if (/^[-*•]\s+/.test(trimmed)) return true;
    if (/^\d+\.\s+/.test(trimmed)) return true;
    if (trimmed.startsWith('|')) return true;
    if (trimmed.startsWith('```')) return true;
    if (trimmed.startsWith(':::')) return true;
    if (/^[┌┐└┘├┤┬┴┼│]/.test(trimmed)) return true;
    if (/^[╭╮╰╯│]/.test(trimmed)) return true;
    return false;
  }
  return false;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

function ToolCallPanel({
  toolCalls,
  toolResults,
  verboseTools,
}: {
  toolCalls: ToolCall[];
  toolResults?: ToolResult[];
  verboseTools?: boolean;
}) {
  if (toolCalls.length === 0) return null;

  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const panelWidth = Math.max(1, columns - 2);
  const innerWidth = Math.max(1, panelWidth - 4);

  const resultMap = new Map<string, ToolResult>();
  for (const result of toolResults || []) {
    resultMap.set(result.toolCallId, result);
  }

  const hasError = toolCalls.some((toolCall) => resultMap.get(toolCall.id)?.isError);
  const allComplete = toolCalls.every((toolCall) => resultMap.has(toolCall.id));
  const borderColor = hasError ? 'red' : allComplete ? 'green' : 'yellow';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      width={panelWidth}
    >
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
        const maxLine = Math.max(1, innerWidth - 2);
        const summaryLine = truncate(formatToolCall(toolCall), maxLine);
        const resultText = result
          ? indentMultiline(truncateToolResult(result, 4, 400, { verbose: verboseTools }), '  ')
          : '';
        return (
          <Box key={toolCall.id} flexDirection="column" marginTop={1}>
            <Box>
              <Text color={statusColor}>{statusIcon} </Text>
              <Text color={statusColor} bold>{displayName}</Text>
              {context && <Text dimColor> · {context}</Text>}
            </Box>
            <Text dimColor>{summaryLine}</Text>
            {result && (
              <Box marginLeft={2}>
                <Text dimColor>↳ {resultText}</Text>
              </Box>
            )}
            {result && !verboseTools && result.truncated && (
              <Box marginLeft={2}>
                <Text dimColor>↳ (truncated · Ctrl+O for full output)</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function ToolResultPanel({
  toolResults,
  verboseTools,
}: {
  toolResults: ToolResult[];
  verboseTools?: boolean;
}) {
  if (toolResults.length === 0) return null;

  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const panelWidth = Math.max(1, columns - 2);
  const innerWidth = Math.max(1, panelWidth - 4);

  const hasError = toolResults.some((result) => result.isError);
  const borderColor = hasError ? 'red' : 'green';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      width={panelWidth}
    >
      <Box justifyContent="space-between">
        <Text color={borderColor} bold>Tool Results</Text>
        <Text dimColor>{toolResults.length}</Text>
      </Box>
      {toolResults.map((result, index) => {
        const statusIcon = result.isError ? '✗' : '✓';
        const statusColor = result.isError ? 'red' : 'green';
        const title = result.toolName ? `${result.toolName}` : `Result ${index + 1}`;
        const maxLine = Math.max(1, innerWidth - 2);
        const summaryLine = truncate(title, maxLine);
        const resultText = indentMultiline(truncateToolResult(result, 4, 400, { verbose: verboseTools }), '  ');
        return (
          <Box key={`${result.toolCallId}-${index}`} flexDirection="column" marginTop={1}>
            <Box>
              <Text color={statusColor}>{statusIcon} </Text>
              <Text color={statusColor} bold>{summaryLine}</Text>
            </Box>
            <Box marginLeft={2}>
              <Text dimColor>↳ {resultText}</Text>
            </Box>
            {!verboseTools && result.truncated && (
              <Box marginLeft={2}>
                <Text dimColor>↳ (truncated · Ctrl+O for full output)</Text>
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
      return basename(path) || path;
    case 'write':
      const writePath = String(input.filename || input.path || input.file_path || '');
      return basename(writePath) || writePath;
    case 'glob':
      return truncate(String(input.pattern || ''), 20);
    case 'grep':
      return truncate(String(input.pattern || ''), 20);
    case 'schedule':
      return String(input.action || '');
    case 'submit_feedback':
      return String(input.type || 'feedback');
    case 'web_search':
      return truncate(String(input.query || ''), 20);
    case 'web_fetch':
    case 'curl':
      const url = String(input.url || '');
      try {
        return new URL(url).hostname;
      } catch {
        return truncate(url, 20);
      }
    default:
      // Try common field names for context
      const action = input.action || input.command || input.operation;
      if (action) return truncate(String(action), 20);
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
    case 'schedule':
      return 'schedule';
    case 'submit_feedback':
      return 'feedback';
    case 'ask_user':
      return 'ask';
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
    case 'schedule':
      return formatScheduleCall(input);
    case 'submit_feedback':
      return formatFeedbackCall(input);
    case 'ask_user': {
      const title = String(input.title || '');
      const question = Array.isArray(input.questions) && input.questions[0]?.question
        ? String(input.questions[0].question)
        : '';
      const label = title || question || 'asking user';
      return `Asking: ${truncate(label, 60)}`;
    }
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
      // For connector tools (connect-*), try to format nicely
      if (name.startsWith('connect_') || name.startsWith('connect-') || name.includes('_') || name.includes('-')) {
        const action = String(input.command || input.action || input.operation || '');
        if (action) {
          return `${formatToolDisplayName(name)}: ${truncate(action, 50)}`;
        }
      }
      return `${formatToolDisplayName(name)}: ${truncate(JSON.stringify(input), 50)}`;
  }
}

function formatToolDisplayName(name: string): string {
  // Convert snake_case to Title Case
  return name
    .replace(/^connect[_-]/, '')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatScheduleCall(input: Record<string, unknown>): string {
  const action = String(input.action || '');
  switch (action) {
    case 'list':
      return 'Listing scheduled tasks';
    case 'create':
      const cmd = truncate(String(input.command || ''), 30);
      const when = input.cron ? `cron ${input.cron}` : String(input.at || '');
      const schedule = when ? ` (${truncate(String(when), 40)})` : '';
      return `Creating schedule: "${cmd}"${schedule}`;
    case 'update':
      return `Updating schedule: ${input.id || 'unknown'}`;
    case 'delete':
      return `Deleting schedule: ${input.id || 'unknown'}`;
    case 'pause':
      return `Pausing schedule: ${input.id || 'unknown'}`;
    case 'resume':
      return `Resuming schedule: ${input.id || 'unknown'}`;
    default:
      return `Schedule: ${action || 'unknown action'}`;
  }
}

function formatFeedbackCall(input: Record<string, unknown>): string {
  const type = String(input.type || 'feedback');
  const title = truncate(String(input.title || ''), 40);
  return `Submitting ${type}: ${title}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function indentMultiline(text: string, padding: string): string {
  const parts = text.split('\n');
  if (parts.length <= 1) return text;
  return [parts[0], ...parts.slice(1).map((line) => `${padding}${line}`)].join('\n');
}

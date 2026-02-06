import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ScheduledCommand } from '@hasna/assistants-shared';

/**
 * Render markdown-like content as styled Ink components.
 * Supports: **bold**, *italic*, `code`, - bullet lists, --- separators.
 * Headings (## / ###) render as bold text (no special sizing).
 */
function MarkdownContent({ content, color }: { content: string; color?: string }) {
  if (!content) return <Text dimColor>(empty)</Text>;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Horizontal rule: --- or ***
    if (/^[-*]{3,}\s*$/.test(line.trim())) {
      elements.push(
        <Box key={i} marginY={0}>
          <Text dimColor>{'─'.repeat(48)}</Text>
        </Box>
      );
      continue;
    }

    // Heading: ## or ### - render as bold, no special sizing
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const text = headingMatch[2];
      elements.push(
        <Box key={i} marginTop={i > 0 ? 0 : 0}>
          <Text bold color={color}>{renderInlineFormatting(text)}</Text>
        </Box>
      );
      continue;
    }

    // Bullet list: - item or * item
    const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      const text = bulletMatch[3];
      elements.push(
        <Box key={i} paddingLeft={indent > 0 ? 2 : 0}>
          <Text dimColor>  {'›'} </Text>
          <Text color={color} wrap="wrap">{renderInlineFormatting(text)}</Text>
        </Box>
      );
      continue;
    }

    // Numbered list: 1. item or 1) item
    const numberedMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (numberedMatch) {
      const num = numberedMatch[2];
      const text = numberedMatch[3];
      elements.push(
        <Box key={i}>
          <Text dimColor>  {num}. </Text>
          <Text color={color} wrap="wrap">{renderInlineFormatting(text)}</Text>
        </Box>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<Box key={i}><Text> </Text></Box>);
      continue;
    }

    // Regular text with inline formatting
    elements.push(
      <Box key={i}>
        <Text color={color} wrap="wrap">{renderInlineFormatting(line)}</Text>
      </Box>
    );
  }

  return <Box flexDirection="column">{elements}</Box>;
}

/**
 * Process inline markdown: **bold**, *italic*, `code`
 * Returns an array of React elements for Ink's Text component.
 */
function renderInlineFormatting(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match **bold**, *italic*, `code`, or plain text
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // **bold**
      parts.push(<Text key={key++} bold>{match[2]}</Text>);
    } else if (match[3]) {
      // *italic*
      parts.push(<Text key={key++} dimColor>{match[3]}</Text>);
    } else if (match[4]) {
      // `code`
      parts.push(<Text key={key++} color="cyan">{match[4]}</Text>);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

interface SchedulesPanelProps {
  schedules: ScheduledCommand[];
  onPause: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRun: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

type Mode = 'list' | 'detail' | 'delete-confirm';

const STATUS_ICONS: Record<ScheduledCommand['status'], string> = {
  active: '●',
  paused: '◐',
  completed: '✓',
  error: '✗',
};

const STATUS_COLORS: Record<ScheduledCommand['status'], string | undefined> = {
  active: 'green',
  paused: 'yellow',
  completed: 'gray',
  error: 'red',
};

const KIND_LABELS: Record<string, string> = {
  once: 'One-time',
  cron: 'Cron',
  random: 'Random',
  interval: 'Interval',
};

const ACTION_ICONS: Record<string, string> = {
  command: '⌘',
  message: '💬',
};

/**
 * Get display text for a schedule action (command or message)
 */
function getActionDisplay(schedule: ScheduledCommand): { type: string; content: string } {
  const actionType = schedule.actionType || 'command';
  if (actionType === 'message' && schedule.message) {
    return { type: 'message', content: schedule.message };
  }
  return { type: 'command', content: schedule.command };
}

/**
 * Format relative time for display
 */
function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return 'n/a';

  const now = Date.now();
  const diff = timestamp - now;
  const absDiff = Math.abs(diff);
  const isPast = diff < 0;

  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let timeStr: string;
  if (days > 0) {
    timeStr = `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    timeStr = `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    timeStr = `${minutes}m`;
  } else {
    timeStr = `${seconds}s`;
  }

  return isPast ? `${timeStr} ago` : `in ${timeStr}`;
}

/**
 * Format absolute time for detail view
 */
function formatAbsoluteTime(timestamp: number | undefined): string {
  if (!timestamp) return 'n/a';
  return new Date(timestamp).toLocaleString();
}

/**
 * Get schedule description
 */
function getScheduleDescription(schedule: ScheduledCommand): string {
  const { kind, cron, at, interval, unit, minInterval, maxInterval } = schedule.schedule;

  switch (kind) {
    case 'once':
      return at ? `At ${at}` : 'One-time';
    case 'cron':
      return cron || 'Cron schedule';
    case 'interval':
      return `Every ${interval} ${unit || 'minutes'}`;
    case 'random':
      return `Random ${minInterval}-${maxInterval} ${unit || 'minutes'}`;
    default:
      return kind;
  }
}

export function SchedulesPanel({
  schedules,
  onPause,
  onResume,
  onDelete,
  onRun,
  onRefresh,
  onClose,
}: SchedulesPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sort schedules: active first, then by next run time
  const sortedSchedules = [...schedules].sort((a, b) => {
    // Active schedules first
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    // Then by next run time
    const aNext = a.nextRunAt || Infinity;
    const bNext = b.nextRunAt || Infinity;
    return aNext - bNext;
  });

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, sortedSchedules.length - 1)));
  }, [sortedSchedules.length]);

  const selectedSchedule = sortedSchedules[selectedIndex];

  useInput((input, key) => {
    // Delete confirmation mode
    if (mode === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        if (selectedSchedule) {
          setIsSubmitting(true);
          onDelete(selectedSchedule.id).finally(() => {
            setIsSubmitting(false);
            setMode('list');
          });
        }
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
        return;
      }
      return;
    }

    // Detail mode
    if (mode === 'detail') {
      if (key.escape || input === 'q') {
        setMode('list');
        return;
      }
      // Actions in detail mode
      if (input === 'p' || input === 'P') {
        if (selectedSchedule && selectedSchedule.status === 'active') {
          setIsSubmitting(true);
          onPause(selectedSchedule.id).finally(() => setIsSubmitting(false));
        }
        return;
      }
      if (input === 'r' || input === 'R') {
        if (selectedSchedule && selectedSchedule.status === 'paused') {
          setIsSubmitting(true);
          onResume(selectedSchedule.id).finally(() => setIsSubmitting(false));
        } else if (selectedSchedule) {
          // Run now
          setIsSubmitting(true);
          onRun(selectedSchedule.id).finally(() => setIsSubmitting(false));
        }
        return;
      }
      if (input === 'd' || input === 'D') {
        setMode('delete-confirm');
        return;
      }
      return;
    }

    // List mode
    if (key.escape || input === 'q') {
      onClose();
      return;
    }

    if (key.return) {
      if (sortedSchedules.length > 0) {
        setMode('detail');
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? sortedSchedules.length - 1 : prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev === sortedSchedules.length - 1 ? 0 : prev + 1));
      return;
    }

    // p: pause selected
    if (input === 'p' || input === 'P') {
      if (selectedSchedule && selectedSchedule.status === 'active') {
        setIsSubmitting(true);
        onPause(selectedSchedule.id).finally(() => setIsSubmitting(false));
      }
      return;
    }

    // r: resume selected or run now
    if (input === 'r' || input === 'R') {
      if (selectedSchedule) {
        setIsSubmitting(true);
        if (selectedSchedule.status === 'paused') {
          onResume(selectedSchedule.id).finally(() => setIsSubmitting(false));
        } else {
          onRun(selectedSchedule.id).finally(() => setIsSubmitting(false));
        }
      }
      return;
    }

    // d: delete selected
    if (input === 'd' || input === 'D') {
      if (selectedSchedule) {
        setMode('delete-confirm');
      }
      return;
    }

    // f: refresh list
    if (input === 'f' || input === 'F') {
      setIsSubmitting(true);
      onRefresh().finally(() => setIsSubmitting(false));
      return;
    }

    // Number keys for quick selection
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= sortedSchedules.length) {
      setSelectedIndex(num - 1);
      return;
    }
  });

  // Delete confirmation mode
  if (mode === 'delete-confirm') {
    const action = selectedSchedule ? getActionDisplay(selectedSchedule) : { type: 'command', content: '' };
    const displayContent = action.content.slice(0, 50) + (action.content.length > 50 ? '...' : '');
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Schedule</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            Delete {action.type}: &quot;{displayContent}&quot;?
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Press <Text color="green" bold>y</Text> to confirm or{' '}
            <Text color="red" bold>n</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // Detail mode
  if (mode === 'detail' && selectedSchedule) {
    const s = selectedSchedule;
    const statusIcon = STATUS_ICONS[s.status];
    const statusColor = STATUS_COLORS[s.status];

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Schedule Details</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
          <Box>
            <Text bold>ID: </Text>
            <Text>{s.id}</Text>
          </Box>

          <Box>
            <Text bold>Status: </Text>
            <Text color={statusColor}>{statusIcon} {s.status}</Text>
          </Box>

          <Box>
            <Text bold>Type: </Text>
            <Text>{KIND_LABELS[s.schedule.kind] || s.schedule.kind}</Text>
          </Box>

          <Box>
            <Text bold>Schedule: </Text>
            <Text>{getScheduleDescription(s)}</Text>
          </Box>

          <Box>
            <Text bold>Action Type: </Text>
            <Text>{ACTION_ICONS[s.actionType || 'command']} {s.actionType || 'command'}</Text>
          </Box>

          {s.description && (
            <Box>
              <Text bold>Description: </Text>
              <Text>{s.description}</Text>
            </Box>
          )}

          {/* Show command or message based on action type */}
          {(s.actionType || 'command') === 'command' ? (
            <>
              <Box marginTop={1}>
                <Text bold>Command: </Text>
              </Box>
              <Box marginLeft={2}>
                <Text wrap="wrap" color="cyan">{s.command}</Text>
              </Box>
            </>
          ) : (
            <>
              <Box marginTop={1}>
                <Text bold>Prompt:</Text>
              </Box>
              <Box marginLeft={1} flexDirection="column" marginTop={0}>
                <MarkdownContent content={s.message || ''} />
              </Box>
            </>
          )}

          <Box marginTop={1}>
            <Text bold>Next Run: </Text>
            <Text color={s.status === 'active' ? 'green' : undefined}>
              {formatAbsoluteTime(s.nextRunAt)} ({formatRelativeTime(s.nextRunAt)})
            </Text>
          </Box>

          <Box>
            <Text bold>Last Run: </Text>
            <Text>{formatAbsoluteTime(s.lastRunAt)}</Text>
          </Box>

          {s.lastResult && (
            <Box>
              <Text bold>Last Result: </Text>
              <Text color={s.lastResult.ok ? 'green' : 'red'}>
                {s.lastResult.ok ? 'Success' : `Error: ${s.lastResult.error}`}
              </Text>
            </Box>
          )}

          <Box>
            <Text bold>Created: </Text>
            <Text>{formatAbsoluteTime(s.createdAt)} by {s.createdBy}</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            {s.status === 'active' ? '[p]ause' : s.status === 'paused' ? '[r]esume' : ''}{' '}
            [r]un now | [d]elete | Esc back
          </Text>
        </Box>

        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">Processing...</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Count by status
  const activeCount = schedules.filter((s) => s.status === 'active').length;
  const pausedCount = schedules.filter((s) => s.status === 'paused').length;
  const completedCount = schedules.filter((s) => s.status === 'completed').length;
  const errorCount = schedules.filter((s) => s.status === 'error').length;

  // List mode
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text bold>Schedules</Text>
        </Box>
        <Text dimColor>[p]ause [r]esume [d]elete [f]refresh</Text>
      </Box>

      {/* Status summary */}
      <Box marginBottom={1}>
        <Text dimColor>
          {activeCount} active, {pausedCount} paused, {completedCount} done, {errorCount} errors
        </Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        {sortedSchedules.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No schedules. Use /schedule to create one.</Text>
          </Box>
        ) : (
          sortedSchedules.map((schedule, index) => {
            const isSelected = index === selectedIndex;
            const statusIcon = STATUS_ICONS[schedule.status];
            const statusColor = STATUS_COLORS[schedule.status];
            const nextRun = formatRelativeTime(schedule.nextRunAt);
            const action = getActionDisplay(schedule);
            const actionIcon = ACTION_ICONS[action.type];
            const content = action.content.slice(0, 30) + (action.content.length > 30 ? '...' : '');
            const kindLabel = KIND_LABELS[schedule.schedule.kind] || schedule.schedule.kind;

            return (
              <Box key={schedule.id} paddingY={0}>
                <Text inverse={isSelected} dimColor={!isSelected && schedule.status === 'completed'}>
                  <Text color={statusColor}>{statusIcon}</Text>
                  {' '}
                  {actionIcon} {index + 1}. {content.padEnd(32)} {kindLabel.padEnd(10)} {nextRun}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Selected schedule preview */}
      {sortedSchedules.length > 0 && selectedSchedule && (
        <Box marginTop={1} flexDirection="column">
          {(() => {
            const action = getActionDisplay(selectedSchedule);
            return (
              <Text dimColor>
                <Text bold>{action.type === 'message' ? 'Message:' : 'Command:'}</Text> {action.content}
              </Text>
            );
          })()}
          <Text dimColor>
            <Text bold>Schedule:</Text> {getScheduleDescription(selectedSchedule)}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          Enter view | ↑/↓ navigate | Esc close
        </Text>
      </Box>

      {isSubmitting && (
        <Box marginTop={1}>
          <Text color="yellow">Processing...</Text>
        </Box>
      )}
    </Box>
  );
}

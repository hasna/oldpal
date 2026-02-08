import React, { useState } from 'react';
import { Box, Text } from 'ink';
import type { RecoverableSession } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface RecoveryPanelProps {
  sessions: RecoverableSession[];
  onRecover: (session: RecoverableSession) => void;
  onStartFresh: () => void;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getStateLabel(state: string): string {
  return state === 'processing'
    ? 'processing'
    : state === 'waiting_input'
    ? 'waiting for input'
    : 'active';
}

function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  // Try to show the last significant part
  const parts = path.split('/');
  let result = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0 && result.length < maxLen - 4; i--) {
    const candidate = parts[i] + '/' + result;
    if (candidate.length > maxLen - 4) break;
    result = candidate;
  }
  return '.../' + result;
}

export function RecoveryPanel({ sessions, onRecover, onStartFresh }: RecoveryPanelProps) {
  // Selected index: 0 to sessions.length-1 are sessions, sessions.length is "Start fresh"
  // Default to "Start fresh" option
  const [selectedIndex, setSelectedIndex] = useState(sessions.length);
  const totalItems = sessions.length + 1; // sessions + "Start fresh" option

  useInput((input, key) => {
    // Navigate up/down
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? totalItems - 1 : prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev === totalItems - 1 ? 0 : prev + 1));
      return;
    }

    // Number keys for quick selection (1-9 for sessions)
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= sessions.length) {
      setSelectedIndex(num - 1);
      return;
    }

    // 's' or '0' for start fresh
    if (input === 's' || input === 'S' || input === '0') {
      setSelectedIndex(sessions.length);
      return;
    }

    // Enter to confirm selection
    if (key.return) {
      if (selectedIndex < sessions.length) {
        onRecover(sessions[selectedIndex]);
      } else {
        onStartFresh();
      }
      return;
    }

    // Escape to start fresh (same as selecting "Start fresh")
    if (key.escape) {
      onStartFresh();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          Session Recovery Available
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          {sessions.length} recoverable session{sessions.length !== 1 ? 's' : ''} found. Select one to resume or start fresh.
        </Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        marginBottom={1}
      >
        {sessions.map((session, index) => {
          const isSelected = index === selectedIndex;
          const stateLabel = getStateLabel(session.heartbeat.state);
          const timeAgo = formatTimeAgo(session.lastActivity);
          const cwdDisplay = truncatePath(session.cwd, 30);
          const msgCount = session.messageCount > 0 ? ` • ${session.messageCount} msgs` : '';

          return (
            <Box key={session.sessionId} paddingY={0}>
              <Text inverse={isSelected}>
                {isSelected ? '▶' : ' '} {index + 1}. {cwdDisplay}{msgCount}
                <Text dimColor> ({stateLabel}, {timeAgo})</Text>
              </Text>
            </Box>
          );
        })}

        {/* Separator */}
        <Box marginY={0}>
          <Text dimColor>────────────────────────────────────</Text>
        </Box>

        {/* Start fresh option */}
        <Box paddingY={0}>
          <Text inverse={selectedIndex === sessions.length} color={selectedIndex === sessions.length ? 'cyan' : undefined}>
            {selectedIndex === sessions.length ? '▶' : ' '} Start fresh (new session)
          </Text>
        </Box>
      </Box>

      {/* Details of selected session */}
      {selectedIndex < sessions.length && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>Selected session details:</Text>
          <Text>  Directory: <Text color="cyan">{sessions[selectedIndex].cwd}</Text></Text>
          <Text>  Last activity: {formatTimeAgo(sessions[selectedIndex].lastActivity)}</Text>
          <Text>  State: {getStateLabel(sessions[selectedIndex].heartbeat.state)}</Text>
          {sessions[selectedIndex].messageCount > 0 && (
            <Text>  Messages: {sessions[selectedIndex].messageCount}</Text>
          )}
        </Box>
      )}

      <Box>
        <Text dimColor>
          ↑/↓ navigate • Enter to select • Esc for fresh • 1-{Math.min(9, sessions.length)} quick select
        </Text>
      </Box>
    </Box>
  );
}

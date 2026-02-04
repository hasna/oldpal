import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { RecoverableSession } from '@hasna/assistants-core';

interface RecoveryPanelProps {
  session: RecoverableSession;
  onRecover: () => void;
  onDiscard: () => void;
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

export function RecoveryPanel({ session, onRecover, onDiscard }: RecoveryPanelProps) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      onRecover();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onDiscard();
    }
  });

  const stateLabel = session.heartbeat.state === 'processing'
    ? 'was processing'
    : session.heartbeat.state === 'waiting_input'
    ? 'was waiting for input'
    : 'was active';

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          Session Recovery Available
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text color="gray">A previous session {stateLabel} when it was interrupted.</Text>
        </Text>
        <Text>
          <Text color="gray">Last activity: </Text>
          <Text>{formatTimeAgo(session.lastActivity)}</Text>
        </Text>
        {session.messageCount > 0 && (
          <Text>
            <Text color="gray">Messages: </Text>
            <Text>{session.messageCount}</Text>
          </Text>
        )}
        <Text>
          <Text color="gray">Directory: </Text>
          <Text>{session.cwd}</Text>
        </Text>
      </Box>

      <Box>
        <Text>
          <Text color="green">[Y]</Text>
          <Text> Resume session  </Text>
          <Text color="red">[N]</Text>
          <Text> Start fresh</Text>
        </Text>
      </Box>
    </Box>
  );
}

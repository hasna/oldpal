import React from 'react';
import { Box, Text } from 'ink';

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxContextTokens: number;
}

interface StatusProps {
  isProcessing: boolean;
  cwd: string;
  queueLength?: number;
  tokenUsage?: TokenUsage;
}

export function Status({ isProcessing, cwd, queueLength = 0, tokenUsage }: StatusProps) {
  // Truncate cwd if too long
  const maxCwdLength = 30;
  const displayCwd =
    cwd.length > maxCwdLength
      ? '...' + cwd.slice(-(maxCwdLength - 3))
      : cwd;

  const queueInfo = queueLength > 0 ? ` | ${queueLength} queued` : '';

  // Format token usage
  let tokenInfo = '';
  if (tokenUsage && tokenUsage.totalTokens > 0) {
    const used = Math.round(tokenUsage.totalTokens / 1000);
    const max = Math.round(tokenUsage.maxContextTokens / 1000);
    const percent = Math.round((tokenUsage.totalTokens / tokenUsage.maxContextTokens) * 100);
    tokenInfo = ` | ${used}k/${max}k (${percent}%)`;
  }

  return (
    <Box
      marginTop={1}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      <Text dimColor>{displayCwd}</Text>
      <Box>
        <Text dimColor={!isProcessing}>
          {isProcessing ? '● processing' : '● ready'}
        </Text>
        <Text dimColor>{tokenInfo}</Text>
        <Text dimColor>{queueInfo}</Text>
        <Text dimColor> | {isProcessing ? 'Esc to stop' : 'Ctrl+C to exit'} | /help</Text>
      </Box>
    </Box>
  );
}

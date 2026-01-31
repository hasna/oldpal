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
  sessionIndex?: number;
  sessionCount?: number;
  backgroundProcessingCount?: number;
}

export function Status({
  isProcessing,
  cwd,
  queueLength = 0,
  tokenUsage,
  sessionIndex,
  sessionCount,
  backgroundProcessingCount = 0,
}: StatusProps) {
  // Format context usage
  let contextInfo = '';
  if (tokenUsage && tokenUsage.maxContextTokens > 0) {
    const percent = Math.round((tokenUsage.totalTokens / tokenUsage.maxContextTokens) * 100);
    contextInfo = `${percent}% context`;
  }

  // Session info
  const sessionInfo = sessionIndex && sessionCount
    ? `Session ${sessionIndex}/${sessionCount}`
    : '';

  // Background processing indicator
  const bgIndicator = backgroundProcessingCount > 0
    ? ` (${backgroundProcessingCount} processing)`
    : '';

  return (
    <Box marginTop={1} justifyContent="space-between">
      <Text dimColor>/help for commands{sessionCount && sessionCount > 1 ? ' | Ctrl+S sessions' : ''}</Text>
      <Box>
        {isProcessing && <Text dimColor>esc to stop · </Text>}
        {sessionInfo && (
          <Text dimColor>
            {sessionInfo}{bgIndicator}
            {contextInfo ? ' · ' : ''}
          </Text>
        )}
        {contextInfo && <Text dimColor>{contextInfo}</Text>}
      </Box>
    </Box>
  );
}

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
  // Format context usage
  let contextInfo = '';
  if (tokenUsage && tokenUsage.maxContextTokens > 0) {
    const percent = Math.round((tokenUsage.totalTokens / tokenUsage.maxContextTokens) * 100);
    contextInfo = `${percent}% context used`;
  }

  return (
    <Box marginTop={1} justifyContent="space-between">
      <Text dimColor>/help for commands</Text>
      <Box>
        {isProcessing && <Text dimColor>esc to stop · </Text>}
        {contextInfo && <Text dimColor>{contextInfo}</Text>}
      </Box>
    </Box>
  );
}

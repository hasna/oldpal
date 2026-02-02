import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { EnergyState, VoiceState, ActiveIdentityInfo } from '@hasna/assistants-shared';

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
  energyState?: EnergyState;
  voiceState?: VoiceState;
  identityInfo?: ActiveIdentityInfo;
  sessionIndex?: number;
  sessionCount?: number;
  backgroundProcessingCount?: number;
  sessionId?: string | null;
  processingStartTime?: number;
}

export function Status({
  isProcessing,
  cwd,
  queueLength = 0,
  tokenUsage,
  energyState,
  voiceState,
  identityInfo,
  sessionIndex,
  sessionCount,
  backgroundProcessingCount = 0,
  sessionId,
  processingStartTime,
}: StatusProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isProcessing || !processingStartTime) {
      setElapsed(0);
      return;
    }

    const update = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - processingStartTime) / 1000)));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isProcessing, processingStartTime]);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  // Format context usage
  let contextInfo = '';
  if (tokenUsage && tokenUsage.maxContextTokens > 0) {
    const rawPercent = Math.round((tokenUsage.totalTokens / tokenUsage.maxContextTokens) * 100);
    const percent = Math.max(0, Math.min(100, rawPercent));
    contextInfo = `${percent}%`;
  }

  // Session indicator (only show if multiple sessions)
  const sessionInfo = sessionIndex && sessionCount && sessionCount > 1
    ? `${sessionIndex}/${sessionCount}`
    : '';

  // Background processing indicator
  const bgIndicator = backgroundProcessingCount > 0
    ? ` +${backgroundProcessingCount}`
    : '';

  // Voice indicator (compact)
  const voiceIcon = voiceState?.enabled
    ? voiceState.isListening ? '🎤' : voiceState.isSpeaking ? '🔊' : '🎙'
    : '';

  const sessionLabel = sessionId ? `id ${sessionId}` : '';

  return (
    <Box marginTop={1} justifyContent="space-between">
      <Text dimColor>/help{sessionCount && sessionCount > 1 ? ' · Ctrl+S' : ''}</Text>
      <Box>
        {voiceIcon && <Text dimColor>{voiceIcon} </Text>}
        {isProcessing && <Text dimColor>esc · </Text>}
        {sessionInfo && <Text dimColor>{sessionInfo}{bgIndicator} · </Text>}
        {contextInfo && <Text dimColor>{contextInfo}</Text>}
        {isProcessing && processingStartTime && (
          <Text dimColor> · {formatDuration(elapsed)}</Text>
        )}
        {sessionLabel && (
          <Text dimColor>{(contextInfo || (isProcessing && processingStartTime) || sessionInfo) ? ' · ' : ''}{sessionLabel}</Text>
        )}
      </Box>
    </Box>
  );
}

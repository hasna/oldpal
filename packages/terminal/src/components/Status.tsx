import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { EnergyState, VoiceState, ActiveIdentityInfo } from '@hasna/assistants-shared';
import { EnergyBar } from './EnergyBar';

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

  const voiceInfo = voiceState?.enabled
    ? `voice ${voiceState.isListening ? 'listening' : voiceState.isSpeaking ? 'speaking' : 'on'}`
    : '';
  const identityLabel = identityInfo?.assistant && identityInfo?.identity
    ? `${identityInfo.assistant.name} · ${identityInfo.identity.name}`
    : '';

  return (
    <Box marginTop={1} justifyContent="space-between">
      <Text dimColor>/help for commands{sessionCount && sessionCount > 1 ? ' | Ctrl+S sessions' : ''}</Text>
      <Box>
        {energyState && (
          <Box marginRight={2}>
            <EnergyBar current={energyState.current} max={energyState.max} />
          </Box>
        )}
        {identityLabel && <Text dimColor>{identityLabel} · </Text>}
        {voiceInfo && <Text dimColor>{voiceInfo} · </Text>}
        {isProcessing && <Text dimColor>esc to stop · </Text>}
        {sessionInfo && (
          <Text dimColor>
            {sessionInfo}{bgIndicator}
            {contextInfo ? ' · ' : ''}
          </Text>
        )}
        {contextInfo && <Text dimColor>{contextInfo}</Text>}
        {sessionId && <Text dimColor>{(sessionInfo || contextInfo) ? ' · ' : ''}id {sessionId}</Text>}
        {isProcessing && processingStartTime && (
          <Text dimColor> · ✻ Worked for {formatDuration(elapsed)}</Text>
        )}
      </Box>
    </Box>
  );
}

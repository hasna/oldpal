import React, { useEffect, useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import type { EnergyState, VoiceState, ActiveIdentityInfo, HeartbeatState } from '@hasna/assistants-shared';

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxContextTokens: number;
}

/**
 * Recent tool call info for status display
 */
export interface RecentToolInfo {
  name: string;
  status: 'running' | 'succeeded' | 'failed';
  durationMs: number;
}

interface StatusProps {
  isProcessing: boolean;
  cwd: string;
  queueLength?: number;
  tokenUsage?: TokenUsage;
  energyState?: EnergyState;
  voiceState?: VoiceState;
  heartbeatState?: HeartbeatState;
  identityInfo?: ActiveIdentityInfo;
  sessionIndex?: number;
  sessionCount?: number;
  backgroundProcessingCount?: number;
  processingStartTime?: number;
  verboseTools?: boolean;
  recentTools?: RecentToolInfo[];
}

export function Status({
  isProcessing,
  cwd,
  queueLength = 0,
  tokenUsage,
  energyState,
  voiceState,
  heartbeatState,
  identityInfo,
  sessionIndex,
  sessionCount,
  backgroundProcessingCount = 0,
  processingStartTime,
  verboseTools = false,
  recentTools = [],
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
  const sessionInfo = sessionCount && sessionCount > 1 && sessionIndex !== undefined
    ? `${sessionIndex + 1}/${sessionCount}`
    : '';

  // Background processing indicator
  const bgIndicator = backgroundProcessingCount > 0
    ? ` +${backgroundProcessingCount}`
    : '';

  // Energy indicator (compact)
  const energyInfo = energyState
    ? `${Math.round((energyState.current / energyState.max) * 100)}%`
    : '';

  // Voice indicator (compact)
  const voiceIcon = voiceState?.enabled
    ? voiceState.isListening ? '🎤' : voiceState.isSpeaking ? '🔊' : '🎙'
    : '';

  // Heartbeat indicator: gray when disabled, green when active, yellow when stale
  const heartbeatIcon = heartbeatState?.enabled
    ? heartbeatState.isStale ? '💛' : '💚'
    : '';

  const queueInfo = queueLength > 0 ? `${queueLength} queued` : '';
  const verboseLabel = verboseTools ? 'verbose' : '';

  // Build recent tools summary (group by tool name with counts)
  const recentToolsSummary = useMemo(() => {
    if (recentTools.length === 0) return '';

    // Group by tool name and count
    const counts = new Map<string, { count: number; failed: number; running: number }>();
    for (const tool of recentTools) {
      const existing = counts.get(tool.name) || { count: 0, failed: 0, running: 0 };
      existing.count++;
      if (tool.status === 'failed') existing.failed++;
      if (tool.status === 'running') existing.running++;
      counts.set(tool.name, existing);
    }

    // Build compact summary: "bash×3 read×2 grep"
    const parts: string[] = [];
    for (const [name, { count, failed, running }] of counts) {
      let part = name;
      if (count > 1) part += `×${count}`;
      if (failed > 0) part += '!';
      if (running > 0) part += '…';
      parts.push(part);
    }

    return parts.slice(0, 4).join(' '); // Limit to 4 tools
  }, [recentTools]);

  return (
    <Box marginTop={1} justifyContent="space-between">
      <Text dimColor>/help{sessionCount && sessionCount > 1 ? ' · Ctrl+]' : ''}</Text>
      <Box>
        {heartbeatIcon && <Text dimColor>{heartbeatIcon} </Text>}
        {voiceIcon && <Text dimColor>{voiceIcon} </Text>}
        {isProcessing && <Text dimColor>esc · </Text>}
        {sessionInfo && <Text dimColor>{sessionInfo}{bgIndicator} · </Text>}
        {energyInfo && <Text dimColor>⚡{energyInfo} · </Text>}
        {contextInfo && <Text dimColor>{contextInfo}</Text>}
        {isProcessing && processingStartTime && (
          <Text dimColor> · {formatDuration(elapsed)}</Text>
        )}
        {verboseLabel && (
          <Text dimColor>{(contextInfo || (isProcessing && processingStartTime) || sessionInfo) ? ' · ' : ''}{verboseLabel}</Text>
        )}
        {queueInfo && (
          <Text dimColor>{(contextInfo || (isProcessing && processingStartTime) || sessionInfo || verboseLabel) ? ' · ' : ''}{queueInfo}</Text>
        )}
        {recentToolsSummary && (
          <Text dimColor>{(contextInfo || (isProcessing && processingStartTime) || sessionInfo || verboseLabel || queueInfo) ? ' · ' : ''}🔧 {recentToolsSummary}</Text>
        )}
      </Box>
    </Box>
  );
}

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { BudgetConfig, BudgetLimits, BudgetUsage } from '@hasna/assistants-shared';
import type { BudgetStatus, BudgetScope } from '@hasna/assistants-core';

interface BudgetPanelProps {
  config: BudgetConfig;
  sessionStatus: BudgetStatus;
  swarmStatus: BudgetStatus;
  onToggleEnabled: (enabled: boolean) => void;
  onReset: (scope: BudgetScope) => void;
  onSetLimits: (scope: BudgetScope, limits: Partial<BudgetLimits>) => void;
  onCancel: () => void;
}

type Mode = 'overview' | 'limits' | 'edit-limits' | 'preset-select';

const PRESET_LIMITS = {
  light: {
    name: 'Light',
    description: 'Low limits for quick tasks',
    session: { maxTotalTokens: 50000, maxLlmCalls: 20, maxToolCalls: 50, maxDurationMs: 10 * 60 * 1000 },
  },
  moderate: {
    name: 'Moderate',
    description: 'Balanced limits for typical work',
    session: { maxTotalTokens: 200000, maxLlmCalls: 50, maxToolCalls: 200, maxDurationMs: 30 * 60 * 1000 },
  },
  heavy: {
    name: 'Heavy',
    description: 'High limits for complex tasks',
    session: { maxTotalTokens: 500000, maxLlmCalls: 100, maxToolCalls: 500, maxDurationMs: 60 * 60 * 1000 },
  },
  unlimited: {
    name: 'Unlimited',
    description: 'No limits (monitoring only)',
    session: {},
  },
};

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function UsageBar({ used, limit, color }: { used: number; limit?: number; color?: string }) {
  if (!limit) {
    return <Text dimColor>no limit</Text>;
  }

  const percent = Math.min(100, Math.round((used / limit) * 100));
  const barWidth = 20;
  const filledWidth = Math.round((percent / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;

  let barColor = 'green';
  if (percent >= 90) barColor = 'red';
  else if (percent >= 75) barColor = 'yellow';

  return (
    <Box>
      <Text color={barColor}>{'█'.repeat(filledWidth)}</Text>
      <Text dimColor>{'░'.repeat(emptyWidth)}</Text>
      <Text> {percent}%</Text>
    </Box>
  );
}

export function BudgetPanel({
  config,
  sessionStatus,
  swarmStatus,
  onToggleEnabled,
  onReset,
  onSetLimits,
  onCancel,
}: BudgetPanelProps) {
  const [mode, setMode] = useState<Mode>('overview');
  const [selectedPreset, setSelectedPreset] = useState(0);

  const presetKeys = Object.keys(PRESET_LIMITS) as (keyof typeof PRESET_LIMITS)[];

  useInput((input, key) => {
    // Preset selection mode
    if (mode === 'preset-select') {
      if (key.upArrow) {
        setSelectedPreset((prev) => (prev === 0 ? presetKeys.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedPreset((prev) => (prev >= presetKeys.length - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return || input === ' ') {
        const preset = PRESET_LIMITS[presetKeys[selectedPreset]];
        onSetLimits('session', preset.session);
        onToggleEnabled(true);
        setMode('overview');
        return;
      }
      if (key.escape || input === 'b' || input === 'B') {
        setMode('overview');
        return;
      }
      if (key.escape || input === 'q' || input === 'Q') {
        onCancel();
        return;
      }
      return;
    }

    // Overview mode shortcuts
    if (mode === 'overview') {
      // Toggle enabled
      if (input === 'e' || input === 'E') {
        onToggleEnabled(true);
        return;
      }
      if (input === 'd' || input === 'D') {
        onToggleEnabled(false);
        return;
      }

      // Reset usage
      if (input === 'r' || input === 'R') {
        onReset('session');
        return;
      }

      // View limits
      if (input === 'l' || input === 'L') {
        setMode('limits');
        return;
      }

      // Set preset
      if (input === 'p' || input === 'P') {
        setMode('preset-select');
        return;
      }
    }

    // Limits mode
    if (mode === 'limits') {
      if (key.escape || input === 'b' || input === 'B') {
        setMode('overview');
        return;
      }
    }

    // Quit
    if (key.escape || input === 'q' || input === 'Q') {
      onCancel();
      return;
    }
  }, { isActive: true });

  // Preset selection mode
  if (mode === 'preset-select') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Select Budget Preset</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
          {presetKeys.map((key, index) => {
            const preset = PRESET_LIMITS[key];
            const isSelected = index === selectedPreset;
            return (
              <Box key={key} marginBottom={index < presetKeys.length - 1 ? 1 : 0}>
                <Text inverse={isSelected}>
                  {isSelected ? '>' : ' '} <Text bold={isSelected}>{preset.name.padEnd(12)}</Text>
                  <Text dimColor={!isSelected}>{preset.description}</Text>
                </Text>
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate | Enter to select | [b]ack | [q]uit</Text>
        </Box>
      </Box>
    );
  }

  // Limits mode
  if (mode === 'limits') {
    const limits = config.session || {};

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Budget Limits</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
          <Box marginBottom={1}>
            <Text bold>Session Limits:</Text>
          </Box>

          <Box paddingLeft={1} flexDirection="column">
            <Box>
              <Text dimColor>Max Total Tokens: </Text>
              <Text>{limits.maxTotalTokens ? formatNumber(limits.maxTotalTokens) : 'unlimited'}</Text>
            </Box>
            <Box>
              <Text dimColor>Max Input Tokens: </Text>
              <Text>{limits.maxInputTokens ? formatNumber(limits.maxInputTokens) : 'unlimited'}</Text>
            </Box>
            <Box>
              <Text dimColor>Max Output Tokens: </Text>
              <Text>{limits.maxOutputTokens ? formatNumber(limits.maxOutputTokens) : 'unlimited'}</Text>
            </Box>
            <Box>
              <Text dimColor>Max LLM Calls: </Text>
              <Text>{limits.maxLlmCalls ?? 'unlimited'}</Text>
            </Box>
            <Box>
              <Text dimColor>Max Tool Calls: </Text>
              <Text>{limits.maxToolCalls ?? 'unlimited'}</Text>
            </Box>
            <Box>
              <Text dimColor>Max Duration: </Text>
              <Text>{limits.maxDurationMs ? formatDuration(limits.maxDurationMs) : 'unlimited'}</Text>
            </Box>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>On Exceeded: </Text>
            <Text color={config.onExceeded === 'stop' ? 'red' : config.onExceeded === 'pause' ? 'yellow' : 'cyan'}>
              {config.onExceeded || 'warn'}
            </Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>[b]ack [q]uit</Text>
        </Box>
      </Box>
    );
  }

  // Overview mode (default)
  const { usage, limits, checks, overallExceeded } = sessionStatus;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Budget</Text>
        <Text color={config.enabled ? 'green' : 'red'}>
          {config.enabled ? 'Enforcing' : 'Disabled'}
        </Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
        {/* Status */}
        <Box marginBottom={1}>
          <Text bold>Status: </Text>
          <Text color={overallExceeded ? 'red' : config.enabled ? 'green' : 'gray'}>
            {overallExceeded ? 'EXCEEDED' : config.enabled ? 'Within limits' : 'Not enforcing'}
          </Text>
        </Box>

        {/* Usage */}
        <Box flexDirection="column">
          <Text bold dimColor>Session Usage:</Text>

          <Box marginTop={1} flexDirection="column">
            {/* Tokens */}
            <Box>
              <Text>{'Tokens:'.padEnd(15)}</Text>
              <Text>{formatNumber(usage.totalTokens).padStart(8)}</Text>
              {limits.maxTotalTokens && (
                <>
                  <Text dimColor> / </Text>
                  <Text>{formatNumber(limits.maxTotalTokens)}</Text>
                </>
              )}
              <Text>  </Text>
              <UsageBar used={usage.totalTokens} limit={limits.maxTotalTokens} />
            </Box>

            {/* LLM Calls */}
            <Box>
              <Text>{'LLM Calls:'.padEnd(15)}</Text>
              <Text>{String(usage.llmCalls).padStart(8)}</Text>
              {limits.maxLlmCalls && (
                <>
                  <Text dimColor> / </Text>
                  <Text>{limits.maxLlmCalls}</Text>
                </>
              )}
              <Text>  </Text>
              <UsageBar used={usage.llmCalls} limit={limits.maxLlmCalls} />
            </Box>

            {/* Tool Calls */}
            <Box>
              <Text>{'Tool Calls:'.padEnd(15)}</Text>
              <Text>{String(usage.toolCalls).padStart(8)}</Text>
              {limits.maxToolCalls && (
                <>
                  <Text dimColor> / </Text>
                  <Text>{limits.maxToolCalls}</Text>
                </>
              )}
              <Text>  </Text>
              <UsageBar used={usage.toolCalls} limit={limits.maxToolCalls} />
            </Box>

            {/* Duration */}
            <Box>
              <Text>{'Duration:'.padEnd(15)}</Text>
              <Text>{formatDuration(usage.durationMs).padStart(8)}</Text>
              {limits.maxDurationMs && (
                <>
                  <Text dimColor> / </Text>
                  <Text>{formatDuration(limits.maxDurationMs)}</Text>
                </>
              )}
              <Text>  </Text>
              <UsageBar used={usage.durationMs} limit={limits.maxDurationMs} />
            </Box>
          </Box>
        </Box>

        {/* Warnings */}
        {sessionStatus.warningsCount > 0 && (
          <Box marginTop={1}>
            <Text color="yellow">⚠ {sessionStatus.warningsCount} warning{sessionStatus.warningsCount !== 1 ? 's' : ''}</Text>
          </Box>
        )}

        {/* Exceeded */}
        {overallExceeded && (
          <Box marginTop={1}>
            <Text color="red" bold>⛔ Budget exceeded! Action: {config.onExceeded || 'warn'}</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [e]nable [d]isable [r]eset [l]imits [p]reset [q]uit
        </Text>
      </Box>
    </Box>
  );
}

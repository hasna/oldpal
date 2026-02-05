import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RegisteredAgent, RegistryStats, RegistryAgentState, AgentType } from '@hasna/assistants-core';

interface AgentsPanelProps {
  agents: RegisteredAgent[];
  stats: RegistryStats;
  onRefresh: () => void;
  onCancel: () => void;
}

type Mode = 'overview' | 'list' | 'details';

const STATE_COLORS: Record<RegistryAgentState, string> = {
  idle: 'green',
  processing: 'yellow',
  waiting_input: 'cyan',
  error: 'red',
  offline: 'gray',
  stopped: 'gray',
};

const TYPE_COLORS: Record<AgentType, string> = {
  assistant: 'cyan',
  subagent: 'magenta',
  coordinator: 'yellow',
  worker: 'green',
};

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

export function AgentsPanel({
  agents,
  stats,
  onRefresh,
  onCancel,
}: AgentsPanelProps) {
  const [mode, setMode] = useState<Mode>('overview');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Sort agents by registration time (most recent first)
  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) =>
      new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime()
    );
  }, [agents]);

  const totalItems = sortedAgents.length;

  useInput((input, key) => {
    // Navigation in list/details mode
    if (mode === 'list' || mode === 'details') {
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev === 0 ? Math.max(0, totalItems - 1) : prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev >= totalItems - 1 ? 0 : prev + 1));
        return;
      }

      // Show details
      if (mode === 'list' && (key.return || input === 'd' || input === 'D')) {
        if (sortedAgents.length > 0) {
          setMode('details');
        }
        return;
      }

      // Back to list/overview
      if (key.escape || input === 'b' || input === 'B') {
        if (mode === 'details') {
          setMode('list');
        } else {
          setMode('overview');
          setSelectedIndex(0);
        }
        return;
      }
    }

    // Overview mode shortcuts
    if (mode === 'overview') {
      // View agents list
      if (input === 'a' || input === 'A') {
        setMode('list');
        setSelectedIndex(0);
        return;
      }

      // Refresh
      if (input === 'r' || input === 'R') {
        onRefresh();
        return;
      }
    }

    // Quit
    if (key.escape || input === 'q' || input === 'Q') {
      onCancel();
      return;
    }
  }, { isActive: true });

  // Details mode - show full agent info
  if (mode === 'details' && sortedAgents.length > 0) {
    const agent = sortedAgents[selectedIndex];

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold>Agent Details</Text>
          <Text dimColor>{selectedIndex + 1} of {sortedAgents.length}</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
          {/* Identity */}
          <Box marginBottom={1} flexDirection="column">
            <Box>
              <Text bold>{agent.name}</Text>
              <Text dimColor> ({agent.id.slice(0, 12)}...)</Text>
            </Box>
            {agent.description && (
              <Box paddingLeft={1}>
                <Text dimColor>{agent.description}</Text>
              </Box>
            )}
          </Box>

          {/* Type & State */}
          <Box marginBottom={1} flexDirection="column">
            <Box>
              <Text dimColor>Type: </Text>
              <Text color={TYPE_COLORS[agent.type]}>{agent.type}</Text>
            </Box>
            <Box>
              <Text dimColor>State: </Text>
              <Text color={STATE_COLORS[agent.status.state]}>{agent.status.state}</Text>
              {agent.status.currentTask && (
                <Text dimColor> ({agent.status.currentTask})</Text>
              )}
            </Box>
          </Box>

          {/* Relationships */}
          {(agent.parentId || agent.childIds.length > 0) && (
            <Box marginBottom={1} flexDirection="column">
              {agent.parentId && (
                <Box>
                  <Text dimColor>Parent: </Text>
                  <Text>{agent.parentId.slice(0, 16)}...</Text>
                </Box>
              )}
              {agent.childIds.length > 0 && (
                <Box>
                  <Text dimColor>Children: </Text>
                  <Text>{agent.childIds.length}</Text>
                </Box>
              )}
            </Box>
          )}

          {/* Capabilities */}
          <Box marginBottom={1} flexDirection="column">
            <Text bold dimColor>Capabilities:</Text>
            {agent.capabilities.tools.length > 0 && (
              <Box paddingLeft={1}>
                <Text dimColor>Tools: </Text>
                <Text>{agent.capabilities.tools.slice(0, 5).join(', ')}</Text>
                {agent.capabilities.tools.length > 5 && (
                  <Text dimColor> +{agent.capabilities.tools.length - 5} more</Text>
                )}
              </Box>
            )}
            {agent.capabilities.skills.length > 0 && (
              <Box paddingLeft={1}>
                <Text dimColor>Skills: </Text>
                <Text>{agent.capabilities.skills.join(', ')}</Text>
              </Box>
            )}
            {agent.capabilities.tags.length > 0 && (
              <Box paddingLeft={1}>
                <Text dimColor>Tags: </Text>
                <Text>{agent.capabilities.tags.join(', ')}</Text>
              </Box>
            )}
          </Box>

          {/* Load */}
          <Box marginBottom={1} flexDirection="column">
            <Text bold dimColor>Load:</Text>
            <Box paddingLeft={1}>
              <Text dimColor>Active Tasks: </Text>
              <Text>{agent.load.activeTasks}</Text>
              <Text dimColor> | Queued: </Text>
              <Text>{agent.load.queuedTasks}</Text>
            </Box>
            <Box paddingLeft={1}>
              <Text dimColor>Tokens: </Text>
              <Text>{agent.load.tokensUsed.toLocaleString()}</Text>
              <Text dimColor> | LLM Calls: </Text>
              <Text>{agent.load.llmCalls}</Text>
            </Box>
            <Box paddingLeft={1}>
              <Text dimColor>Depth: </Text>
              <Text>{agent.load.currentDepth}</Text>
              {agent.capabilities.maxDepth && (
                <Text dimColor>/{agent.capabilities.maxDepth}</Text>
              )}
            </Box>
          </Box>

          {/* Status Metrics */}
          <Box marginBottom={1} flexDirection="column">
            <Text bold dimColor>Metrics:</Text>
            <Box paddingLeft={1}>
              <Text dimColor>Uptime: </Text>
              <Text>{formatUptime(agent.status.uptime)}</Text>
            </Box>
            <Box paddingLeft={1}>
              <Text dimColor>Messages: </Text>
              <Text>{agent.status.messagesProcessed}</Text>
            </Box>
            <Box paddingLeft={1}>
              <Text dimColor>Tool Calls: </Text>
              <Text>{agent.status.toolCallsExecuted}</Text>
            </Box>
            <Box paddingLeft={1}>
              <Text dimColor>Errors: </Text>
              <Text color={agent.status.errorsCount > 0 ? 'red' : 'white'}>{agent.status.errorsCount}</Text>
            </Box>
          </Box>

          {/* Heartbeat */}
          <Box flexDirection="column">
            <Text bold dimColor>Heartbeat:</Text>
            <Box paddingLeft={1}>
              <Text dimColor>Last: </Text>
              <Text>{formatTimestamp(agent.heartbeat.lastHeartbeat)}</Text>
              {agent.heartbeat.isStale && (
                <Text color="red"> (stale)</Text>
              )}
            </Box>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate [b]ack [q]uit</Text>
        </Box>
      </Box>
    );
  }

  // List mode - show all agents
  if (mode === 'list') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold>Registered Agents</Text>
          <Text dimColor>{sortedAgents.length} agent{sortedAgents.length !== 1 ? 's' : ''}</Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          height={Math.min(14, sortedAgents.length + 2)}
          overflowY="hidden"
        >
          {sortedAgents.length === 0 ? (
            <Box paddingY={1}>
              <Text dimColor>No agents registered.</Text>
            </Box>
          ) : (
            sortedAgents.map((agent, index) => {
              const isSelected = index === selectedIndex;
              const stateColor = STATE_COLORS[agent.status.state];
              const typeColor = TYPE_COLORS[agent.type];

              return (
                <Box key={agent.id}>
                  <Text inverse={isSelected}>
                    {isSelected ? '>' : ' '}{' '}
                    <Text color={stateColor}>[{agent.status.state.slice(0, 4).padEnd(4)}]</Text>{' '}
                    <Text bold={isSelected}>{agent.name.slice(0, 18).padEnd(18)}</Text>{' '}
                    <Text color={typeColor}>{agent.type.slice(0, 8).padEnd(8)}</Text>{' '}
                    <Text dimColor>{formatTimestamp(agent.registeredAt)}</Text>
                  </Text>
                </Box>
              );
            })
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate [d]etails [b]ack [q]uit</Text>
        </Box>
      </Box>
    );
  }

  // Overview mode (default)
  const activeAgents = sortedAgents.filter(a => a.status.state !== 'offline' && !a.heartbeat.isStale);
  const processingAgents = sortedAgents.filter(a => a.status.state === 'processing');

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Agent Registry</Text>
        <Text dimColor>
          {activeAgents.length}/{sortedAgents.length} active
        </Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
        {/* Summary Stats */}
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text dimColor>Total Agents: </Text>
            <Text bold>{stats.totalAgents}</Text>
          </Box>
          <Box>
            <Text dimColor>Active: </Text>
            <Text color="green">{activeAgents.length}</Text>
            {processingAgents.length > 0 && (
              <>
                <Text dimColor> | Processing: </Text>
                <Text color="yellow">{processingAgents.length}</Text>
              </>
            )}
            {stats.staleCount > 0 && (
              <>
                <Text dimColor> | Stale: </Text>
                <Text color="red">{stats.staleCount}</Text>
              </>
            )}
          </Box>
        </Box>

        {/* By Type */}
        <Box marginBottom={1} flexDirection="column">
          <Text bold dimColor>By Type:</Text>
          <Box paddingLeft={1}>
            <Text color="cyan">Assistants: {stats.byType.assistant}</Text>
            <Text dimColor> | </Text>
            <Text color="magenta">Subagents: {stats.byType.subagent}</Text>
          </Box>
          <Box paddingLeft={1}>
            <Text color="yellow">Coordinators: {stats.byType.coordinator}</Text>
            <Text dimColor> | </Text>
            <Text color="green">Workers: {stats.byType.worker}</Text>
          </Box>
        </Box>

        {/* By State */}
        <Box marginBottom={1} flexDirection="column">
          <Text bold dimColor>By State:</Text>
          <Box paddingLeft={1}>
            <Text color="green">Idle: {stats.byState.idle}</Text>
            <Text dimColor> | </Text>
            <Text color="yellow">Processing: {stats.byState.processing}</Text>
            <Text dimColor> | </Text>
            <Text color="cyan">Waiting: {stats.byState.waiting_input}</Text>
          </Box>
          <Box paddingLeft={1}>
            <Text color="red">Error: {stats.byState.error}</Text>
            <Text dimColor> | </Text>
            <Text color="gray">Offline: {stats.byState.offline}</Text>
            <Text dimColor> | </Text>
            <Text color="gray">Stopped: {stats.byState.stopped}</Text>
          </Box>
        </Box>

        {/* Average Load */}
        <Box flexDirection="column">
          <Box>
            <Text dimColor>Average Load: </Text>
            <Text color={stats.averageLoad > 0.8 ? 'red' : stats.averageLoad > 0.5 ? 'yellow' : 'green'}>
              {(stats.averageLoad * 100).toFixed(0)}%
            </Text>
          </Box>
          <Box>
            <Text dimColor>Registry Uptime: </Text>
            <Text>{formatUptime(stats.uptime)}</Text>
          </Box>
        </Box>

        {/* Quick agent list preview */}
        {sortedAgents.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold dimColor>Recent Agents:</Text>
            {sortedAgents.slice(0, 3).map((agent) => (
              <Box key={agent.id} paddingLeft={1}>
                <Text color={STATE_COLORS[agent.status.state]}>●</Text>
                <Text> {agent.name}</Text>
                <Text dimColor> ({agent.type})</Text>
              </Box>
            ))}
            {sortedAgents.length > 3 && (
              <Box paddingLeft={1}>
                <Text dimColor>+ {sortedAgents.length - 3} more</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[a]gents list [r]efresh [q]uit</Text>
      </Box>
    </Box>
  );
}

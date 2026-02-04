import React, { useEffect, useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Connector, ConnectorCommand, ConnectorStatus } from '@hasna/assistants-shared';

type ViewMode = 'list' | 'detail' | 'command';

interface ConnectorsPanelProps {
  connectors: Connector[];
  /** Initial connector name to jump to (from /connectors <name>) */
  initialConnector?: string;
  /** Callback to check auth status for a connector */
  onCheckAuth: (connector: Connector) => Promise<ConnectorStatus>;
  /** Callback to get detailed command info (runs <cli> <command> --help) */
  onGetCommandHelp?: (connector: Connector, command: string) => Promise<string>;
  /** Close the panel */
  onClose: () => void;
}

/**
 * Interactive panel for browsing connectors, commands, and parameters
 */
export function ConnectorsPanel({
  connectors,
  initialConnector,
  onCheckAuth,
  onGetCommandHelp,
  onClose,
}: ConnectorsPanelProps) {
  const [mode, setMode] = useState<ViewMode>('list');
  const [connectorIndex, setConnectorIndex] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [authStatuses, setAuthStatuses] = useState<Map<string, ConnectorStatus>>(new Map());
  const [commandHelp, setCommandHelp] = useState<string | null>(null);
  const [isLoadingHelp, setIsLoadingHelp] = useState(false);

  // Jump to initial connector if specified
  useEffect(() => {
    if (initialConnector) {
      const idx = connectors.findIndex(
        (c) => c.name.toLowerCase() === initialConnector.toLowerCase()
      );
      if (idx !== -1) {
        setConnectorIndex(idx);
        setMode('detail');
      }
    }
  }, [initialConnector, connectors]);

  // Load auth statuses on mount
  useEffect(() => {
    const loadStatuses = async () => {
      const results = await Promise.all(
        connectors.map(async (connector) => {
          try {
            const status = await onCheckAuth(connector);
            return { name: connector.name, status };
          } catch {
            return { name: connector.name, status: { authenticated: false, error: 'Failed to check' } };
          }
        })
      );
      const statusMap = new Map<string, ConnectorStatus>();
      for (const { name, status } of results) {
        statusMap.set(name, status);
      }
      setAuthStatuses(statusMap);
    };
    loadStatuses();
  }, [connectors, onCheckAuth]);

  const currentConnector = connectors[connectorIndex];
  const currentCommands = currentConnector?.commands || [];
  const currentCommand = currentCommands[commandIndex];
  const currentStatus = currentConnector ? authStatuses.get(currentConnector.name) : undefined;

  // Load command help when entering command detail view
  const loadCommandHelp = useCallback(async () => {
    if (!currentConnector || !currentCommand || !onGetCommandHelp) {
      setCommandHelp(null);
      return;
    }
    setIsLoadingHelp(true);
    try {
      const help = await onGetCommandHelp(currentConnector, currentCommand.name);
      setCommandHelp(help);
    } catch {
      setCommandHelp(null);
    } finally {
      setIsLoadingHelp(false);
    }
  }, [currentConnector, currentCommand, onGetCommandHelp]);

  useEffect(() => {
    if (mode === 'command') {
      loadCommandHelp();
    } else {
      setCommandHelp(null);
    }
  }, [mode, loadCommandHelp]);

  // Keyboard navigation
  useInput((input, key) => {
    // Exit with q or Escape at top level
    if (input === 'q' || (key.escape && mode === 'list')) {
      onClose();
      return;
    }

    // Escape to go back
    if (key.escape) {
      if (mode === 'command') {
        setMode('detail');
        setCommandHelp(null);
      } else if (mode === 'detail') {
        setMode('list');
        setCommandIndex(0);
      }
      return;
    }

    // Enter to drill down
    if (key.return) {
      if (mode === 'list') {
        setMode('detail');
        setCommandIndex(0);
      } else if (mode === 'detail' && currentCommands.length > 0) {
        setMode('command');
      }
      return;
    }

    // Arrow navigation
    if (key.upArrow) {
      if (mode === 'list') {
        setConnectorIndex((prev) => (prev === 0 ? connectors.length - 1 : prev - 1));
      } else if (mode === 'detail') {
        setCommandIndex((prev) => (prev === 0 ? currentCommands.length - 1 : prev - 1));
      }
      return;
    }

    if (key.downArrow) {
      if (mode === 'list') {
        setConnectorIndex((prev) => (prev === connectors.length - 1 ? 0 : prev + 1));
      } else if (mode === 'detail') {
        setCommandIndex((prev) => (prev === currentCommands.length - 1 ? 0 : prev + 1));
      }
      return;
    }

    // Number keys for quick selection
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1) {
      if (mode === 'list' && num <= connectors.length) {
        setConnectorIndex(num - 1);
      } else if (mode === 'detail' && num <= currentCommands.length) {
        setCommandIndex(num - 1);
      }
    }
  });

  // Render status icon
  const getStatusIcon = (status?: ConnectorStatus): { icon: string; color: string } => {
    if (!status) return { icon: '?', color: 'gray' };
    if (status.error) return { icon: '?', color: 'gray' };
    if (status.authenticated) return { icon: '✓', color: 'green' };
    return { icon: '○', color: 'yellow' };
  };

  // Empty state
  if (connectors.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Connectors</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Text dimColor>No connectors found.</Text>
          <Text dimColor>Connectors are auto-discovered from installed `connect-*` CLIs.</Text>
          <Box marginTop={1}>
            <Text dimColor>Install with: `bun add -g connect-&lt;name&gt;`</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>q quit</Text>
        </Box>
      </Box>
    );
  }

  // Command detail view
  if (mode === 'command' && currentConnector && currentCommand) {
    const cli = currentConnector.cli || `connect-${currentConnector.name}`;
    const hasArgs = currentCommand.args && currentCommand.args.length > 0;
    const hasOptions = currentCommand.options && currentCommand.options.length > 0;

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {currentConnector.name} {'>'} {currentCommand.name}
          </Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Text>{currentCommand.description || 'No description'}</Text>

          {hasArgs && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Arguments:</Text>
              {currentCommand.args.map((arg, idx) => (
                <Box key={idx} marginLeft={2}>
                  <Text color={arg.required ? 'white' : 'gray'}>
                    {arg.name}
                    {arg.required ? ' (required)' : ' (optional)'}
                    {arg.description ? ` - ${arg.description}` : ''}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {hasOptions && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Options:</Text>
              {currentCommand.options.map((opt, idx) => (
                <Box key={idx} marginLeft={2}>
                  <Text dimColor>
                    --{opt.name}
                    {opt.alias ? `, -${opt.alias}` : ''}
                    {opt.type !== 'boolean' ? ` <${opt.type}>` : ''}
                    {opt.default !== undefined ? ` (default: ${String(opt.default)})` : ''}
                    {opt.description ? ` - ${opt.description}` : ''}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {isLoadingHelp && (
            <Box marginTop={1}>
              <Text color="yellow">Loading help...</Text>
            </Box>
          )}

          {commandHelp && !isLoadingHelp && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Help output:</Text>
              <Box marginLeft={2} marginTop={1}>
                <Text dimColor>{commandHelp}</Text>
              </Box>
            </Box>
          )}

          <Box flexDirection="column" marginTop={1}>
            <Text bold>Example:</Text>
            <Box marginLeft={2}>
              <Text color="cyan">{cli} {currentCommand.name}</Text>
            </Box>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Esc back | q quit</Text>
        </Box>
      </Box>
    );
  }

  // Connector detail view
  if (mode === 'detail' && currentConnector) {
    const cli = currentConnector.cli || `connect-${currentConnector.name}`;
    const status = getStatusIcon(currentStatus);

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{currentConnector.name}</Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Box paddingY={1} flexDirection="column">
            <Box>
              <Text>Status: </Text>
              <Text color={status.color}>{status.icon}</Text>
              <Text> </Text>
              <Text color={status.color}>
                {currentStatus?.authenticated
                  ? 'Authenticated'
                  : currentStatus?.error || 'Not authenticated'}
              </Text>
            </Box>
            {currentStatus?.user && (
              <Box>
                <Text dimColor>Account: {currentStatus.user}</Text>
              </Box>
            )}
            {currentStatus?.email && !currentStatus?.user && (
              <Box>
                <Text dimColor>Account: {currentStatus.email}</Text>
              </Box>
            )}
            <Box>
              <Text dimColor>CLI: {cli}</Text>
            </Box>
          </Box>

          <Box marginTop={1} marginBottom={1}>
            <Text bold>Commands:</Text>
          </Box>

          {currentCommands.length === 0 ? (
            <Box paddingBottom={1}>
              <Text dimColor>No commands discovered</Text>
            </Box>
          ) : (
            currentCommands.map((cmd, idx) => {
              const isSelected = idx === commandIndex;
              const prefix = isSelected ? '> ' : '  ';
              const displayName = cmd.name.padEnd(20);

              return (
                <Box key={cmd.name} paddingY={0}>
                  <Text
                    inverse={isSelected}
                    dimColor={!isSelected}
                  >
                    {prefix}{idx + 1}. {displayName} {cmd.description}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            ↑↓ navigate | Enter view command | Esc back | q quit
          </Text>
        </Box>
      </Box>
    );
  }

  // Connector list view (default)
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Connectors</Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        {connectors.map((connector, idx) => {
          const isSelected = idx === connectorIndex;
          const status = getStatusIcon(authStatuses.get(connector.name));
          const cmdCount = connector.commands?.length || 0;
          const prefix = isSelected ? '> ' : '  ';
          const nameDisplay = connector.name.padEnd(16);

          return (
            <Box key={connector.name} paddingY={0}>
              <Text
                inverse={isSelected}
                dimColor={!isSelected}
              >
                {prefix}
              </Text>
              <Text color={status.color} inverse={isSelected}>
                {status.icon}
              </Text>
              <Text
                inverse={isSelected}
                dimColor={!isSelected}
              >
                {' '}{nameDisplay} {cmdCount.toString().padStart(2)} cmd{cmdCount !== 1 ? 's' : ' '}
              </Text>
              <Text
                inverse={isSelected}
                dimColor
              >
                {' '}{connector.description?.slice(0, 30) || ''}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Legend: </Text>
        <Text color="green">✓</Text>
        <Text dimColor> authenticated | </Text>
        <Text color="yellow">○</Text>
        <Text dimColor> not authenticated | </Text>
        <Text color="gray">?</Text>
        <Text dimColor> unknown</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navigate | Enter view | q quit | 1-{connectors.length} jump
        </Text>
      </Box>
    </Box>
  );
}

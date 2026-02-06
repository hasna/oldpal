import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

// Maximum visible items in lists before pagination kicks in
const MAX_VISIBLE_ITEMS = 5;

type ViewMode = 'list' | 'detail' | 'delete-confirm';

interface SecretEntry {
  name: string;
  scope: 'global' | 'assistant';
  createdAt?: string;
  updatedAt?: string;
}

interface SecretsPanelProps {
  secrets: SecretEntry[];
  onGet: (name: string, scope?: 'global' | 'assistant') => Promise<string>;
  onDelete: (name: string, scope: 'global' | 'assistant') => Promise<void>;
  onClose: () => void;
  error?: string | null;
}

/**
 * Calculate the visible window range for paginated lists
 */
function getVisibleRange(
  selectedIndex: number,
  totalItems: number,
  maxVisible: number = MAX_VISIBLE_ITEMS
): { start: number; end: number; hasMore: { above: number; below: number } } {
  if (totalItems <= maxVisible) {
    return {
      start: 0,
      end: totalItems,
      hasMore: { above: 0, below: 0 },
    };
  }

  const halfWindow = Math.floor(maxVisible / 2);
  let start = selectedIndex - halfWindow;
  let end = selectedIndex + (maxVisible - halfWindow);

  if (start < 0) {
    start = 0;
    end = maxVisible;
  }

  if (end > totalItems) {
    end = totalItems;
    start = Math.max(0, totalItems - maxVisible);
  }

  return {
    start,
    end,
    hasMore: {
      above: start,
      below: totalItems - end,
    },
  };
}

/**
 * Interactive panel for managing secrets
 */
export function SecretsPanel({
  secrets,
  onGet,
  onDelete,
  onClose,
  error,
}: SecretsPanelProps) {
  const [mode, setMode] = useState<ViewMode>('list');
  const [secretIndex, setSecretIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SecretEntry | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);

  // Calculate visible range for secrets list
  const secretRange = useMemo(
    () => getVisibleRange(secretIndex, secrets.length),
    [secretIndex, secrets.length]
  );

  const currentSecret = secrets[secretIndex];

  // Handle reveal
  const handleReveal = async () => {
    if (!currentSecret || revealedValue !== null) return;

    setIsProcessing(true);
    try {
      const value = await onGet(currentSecret.name, currentSecret.scope);
      setRevealedValue(value);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsProcessing(true);
    try {
      await onDelete(deleteTarget.name, deleteTarget.scope);
      setMode('list');
      setDeleteTarget(null);
      // Adjust index if needed
      if (secretIndex >= secrets.length - 1 && secretIndex > 0) {
        setSecretIndex(secretIndex - 1);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Keyboard navigation
  useInput((input, key) => {
    if (isProcessing) return;

    // Exit with q or Escape at top level
    if (input === 'q' || (key.escape && mode === 'list')) {
      onClose();
      return;
    }

    // Escape to go back
    if (key.escape) {
      if (mode === 'detail') {
        setMode('list');
        setRevealedValue(null);
      } else if (mode === 'delete-confirm') {
        setMode('detail');
        setDeleteTarget(null);
      }
      return;
    }

    // List mode navigation
    if (mode === 'list') {
      if (key.upArrow) {
        setSecretIndex((prev) => (prev === 0 ? secrets.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setSecretIndex((prev) => (prev === secrets.length - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return && currentSecret) {
        setMode('detail');
        setRevealedValue(null);
        return;
      }
      // Number keys for quick selection
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= secrets.length) {
        setSecretIndex(num - 1);
      }
      return;
    }

    // Detail mode
    if (mode === 'detail') {
      if (input === 'r') {
        handleReveal();
        return;
      }
      if (input === 'x' || key.delete) {
        if (currentSecret) {
          setDeleteTarget(currentSecret);
          setMode('delete-confirm');
        }
        return;
      }
      return;
    }

    // Delete confirm mode
    if (mode === 'delete-confirm') {
      if (input === 'y') {
        handleDelete();
        return;
      }
      if (input === 'n') {
        setMode('detail');
        setDeleteTarget(null);
        return;
      }
    }
  });

  // Empty state
  if (secrets.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Secrets</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Text dimColor>No secrets stored.</Text>
          <Text dimColor>Use the secrets_set tool to add secrets.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>q quit</Text>
        </Box>
      </Box>
    );
  }

  // Delete confirmation
  if (mode === 'delete-confirm' && deleteTarget) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Secret</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="red"
          paddingX={1}
          paddingY={1}
        >
          <Text>Are you sure you want to delete "{deleteTarget.name}"?</Text>
          <Text dimColor>Scope: {deleteTarget.scope}</Text>
          <Text dimColor>This action cannot be undone.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>y confirm | n cancel</Text>
        </Box>
      </Box>
    );
  }

  // Detail view
  if (mode === 'detail' && currentSecret) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{currentSecret.name}</Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Box>
            <Text dimColor>Scope: </Text>
            <Text color={currentSecret.scope === 'global' ? 'yellow' : 'blue'}>
              {currentSecret.scope}
            </Text>
          </Box>

          {currentSecret.createdAt && (
            <Box>
              <Text dimColor>Created: </Text>
              <Text>{new Date(currentSecret.createdAt).toLocaleString()}</Text>
            </Box>
          )}

          {currentSecret.updatedAt && (
            <Box>
              <Text dimColor>Updated: </Text>
              <Text>{new Date(currentSecret.updatedAt).toLocaleString()}</Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>Value: </Text>
            {revealedValue !== null ? (
              <Text color="green">{revealedValue}</Text>
            ) : (
              <Text dimColor>••••••••</Text>
            )}
          </Box>
        </Box>

        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            {revealedValue === null && 'r reveal | '}
            x delete | Esc back
          </Text>
        </Box>
      </Box>
    );
  }

  // List view (default)
  const visibleSecrets = secrets.slice(secretRange.start, secretRange.end);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Secrets</Text>
        {secrets.length > MAX_VISIBLE_ITEMS && (
          <Text dimColor> ({secretIndex + 1}/{secrets.length})</Text>
        )}
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        {secretRange.hasMore.above > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↑ {secretRange.hasMore.above} more above</Text>
          </Box>
        )}

        {visibleSecrets.map((secret, visibleIdx) => {
          const actualIdx = secretRange.start + visibleIdx;
          const isSelected = actualIdx === secretIndex;
          const prefix = isSelected ? '> ' : '  ';
          const nameDisplay = secret.name.padEnd(25);
          const scopeColor = secret.scope === 'global' ? 'yellow' : 'blue';

          return (
            <Box key={`${secret.name}-${secret.scope}`} paddingY={0}>
              <Text inverse={isSelected} dimColor={!isSelected}>
                {prefix}🔑 {nameDisplay}
              </Text>
              <Text color={scopeColor} inverse={isSelected}>
                {secret.scope.padEnd(8)}
              </Text>
            </Box>
          );
        })}

        {secretRange.hasMore.below > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↓ {secretRange.hasMore.below} more below</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Legend: </Text>
        <Text color="yellow">global</Text>
        <Text dimColor> = shared | </Text>
        <Text color="blue">assistant</Text>
        <Text dimColor> = assistant-specific</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select | Enter view | q quit
        </Text>
      </Box>
    </Box>
  );
}

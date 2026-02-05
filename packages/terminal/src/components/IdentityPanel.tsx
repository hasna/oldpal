import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Identity, CreateIdentityOptions } from '@hasna/assistants-core';

// Maximum visible items in lists before pagination kicks in
const MAX_VISIBLE_ITEMS = 5;

type ViewMode = 'list' | 'detail' | 'create' | 'delete-confirm';

interface IdentityPanelProps {
  identities: Identity[];
  activeIdentityId?: string;
  templates: Array<{ name: string; description: string }>;
  onSwitch: (identityId: string) => Promise<void>;
  onCreate: (options: CreateIdentityOptions) => Promise<void>;
  onCreateFromTemplate: (templateName: string) => Promise<void>;
  onSetDefault: (identityId: string) => Promise<void>;
  onDelete: (identityId: string) => Promise<void>;
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
 * Interactive panel for managing identities
 */
export function IdentityPanel({
  identities,
  activeIdentityId,
  templates,
  onSwitch,
  onCreate,
  onCreateFromTemplate,
  onSetDefault,
  onDelete,
  onClose,
  error,
}: IdentityPanelProps) {
  const [mode, setMode] = useState<ViewMode>('list');
  const [identityIndex, setIdentityIndex] = useState(0);
  const [templateIndex, setTemplateIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Identity | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Jump to active identity on mount
  useEffect(() => {
    if (activeIdentityId) {
      const idx = identities.findIndex((i) => i.id === activeIdentityId);
      if (idx !== -1) {
        setIdentityIndex(idx);
      }
    }
  }, [activeIdentityId, identities]);

  // Calculate visible range for identity list
  const identityRange = useMemo(
    () => getVisibleRange(identityIndex, identities.length),
    [identityIndex, identities.length]
  );

  // Calculate visible range for templates list
  const templateRange = useMemo(
    () => getVisibleRange(templateIndex, templates.length),
    [templateIndex, templates.length]
  );

  const currentIdentity = identities[identityIndex];

  // Handle create from template
  const handleCreateFromTemplate = useCallback(async () => {
    const template = templates[templateIndex];
    if (!template) return;

    setIsProcessing(true);
    try {
      await onCreateFromTemplate(template.name);
      setMode('list');
    } finally {
      setIsProcessing(false);
    }
  }, [templateIndex, templates, onCreateFromTemplate]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;

    setIsProcessing(true);
    try {
      await onDelete(deleteTarget.id);
      setMode('list');
      setDeleteTarget(null);
      // Adjust index if needed
      if (identityIndex >= identities.length - 1 && identityIndex > 0) {
        setIdentityIndex(identityIndex - 1);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [deleteTarget, onDelete, identityIndex, identities.length]);

  // Handle switch
  const handleSwitch = useCallback(async () => {
    if (!currentIdentity || currentIdentity.id === activeIdentityId) return;

    setIsProcessing(true);
    try {
      await onSwitch(currentIdentity.id);
    } finally {
      setIsProcessing(false);
    }
  }, [currentIdentity, activeIdentityId, onSwitch]);

  // Handle set default
  const handleSetDefault = useCallback(async () => {
    if (!currentIdentity || currentIdentity.isDefault) return;

    setIsProcessing(true);
    try {
      await onSetDefault(currentIdentity.id);
    } finally {
      setIsProcessing(false);
    }
  }, [currentIdentity, onSetDefault]);

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
      if (mode === 'detail' || mode === 'create') {
        setMode('list');
      } else if (mode === 'delete-confirm') {
        setMode('detail');
        setDeleteTarget(null);
      }
      return;
    }

    // List mode navigation
    if (mode === 'list') {
      if (key.upArrow) {
        setIdentityIndex((prev) => (prev === 0 ? identities.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setIdentityIndex((prev) => (prev === identities.length - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return && currentIdentity) {
        setMode('detail');
        return;
      }
      if (input === 'n' || input === 'c') {
        setMode('create');
        setTemplateIndex(0);
        return;
      }
      // Number keys for quick selection
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= identities.length) {
        setIdentityIndex(num - 1);
      }
      return;
    }

    // Detail mode
    if (mode === 'detail') {
      if (input === 's') {
        handleSwitch();
        return;
      }
      if (input === 'd') {
        handleSetDefault();
        return;
      }
      if (input === 'x' || key.delete) {
        if (currentIdentity) {
          setDeleteTarget(currentIdentity);
          setMode('delete-confirm');
        }
        return;
      }
      return;
    }

    // Create mode (template selection)
    if (mode === 'create') {
      if (key.upArrow) {
        setTemplateIndex((prev) => (prev === 0 ? templates.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setTemplateIndex((prev) => (prev === templates.length - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return) {
        handleCreateFromTemplate();
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
  if (identities.length === 0 && mode === 'list') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Identities</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Text dimColor>No identities found.</Text>
          <Text dimColor>Press n to create a new identity from a template.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>n new | q quit</Text>
        </Box>
      </Box>
    );
  }

  // Delete confirmation
  if (mode === 'delete-confirm' && deleteTarget) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Identity</Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="red"
          paddingX={1}
          paddingY={1}
        >
          <Text>Are you sure you want to delete "{deleteTarget.name}"?</Text>
          <Text dimColor>This action cannot be undone.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>y confirm | n cancel</Text>
        </Box>
      </Box>
    );
  }

  // Create mode (template selection)
  if (mode === 'create') {
    const visibleTemplates = templates.slice(templateRange.start, templateRange.end);

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Create Identity from Template</Text>
          {templates.length > MAX_VISIBLE_ITEMS && (
            <Text dimColor> ({templateIndex + 1}/{templates.length})</Text>
          )}
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          {templateRange.hasMore.above > 0 && (
            <Box paddingY={0}>
              <Text dimColor>  ↑ {templateRange.hasMore.above} more above</Text>
            </Box>
          )}

          {visibleTemplates.map((template, visibleIdx) => {
            const actualIdx = templateRange.start + visibleIdx;
            const isSelected = actualIdx === templateIndex;
            const prefix = isSelected ? '> ' : '  ';

            return (
              <Box key={template.name} paddingY={0}>
                <Text inverse={isSelected} dimColor={!isSelected}>
                  {prefix}{template.name.padEnd(20)} {template.description}
                </Text>
              </Box>
            );
          })}

          {templateRange.hasMore.below > 0 && (
            <Box paddingY={0}>
              <Text dimColor>  ↓ {templateRange.hasMore.below} more below</Text>
            </Box>
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>↑↓ select | Enter create | Esc back</Text>
        </Box>
      </Box>
    );
  }

  // Detail view
  if (mode === 'detail' && currentIdentity) {
    const isActive = currentIdentity.id === activeIdentityId;

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{currentIdentity.name}</Text>
          {currentIdentity.isDefault && <Text color="yellow"> (default)</Text>}
          {isActive && <Text color="green"> (active)</Text>}
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
        >
          <Box marginBottom={1}>
            <Text bold>Profile</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>Display Name: </Text>
            <Text>{currentIdentity.profile.displayName}</Text>
          </Box>
          {currentIdentity.profile.title && (
            <Box marginLeft={2}>
              <Text dimColor>Title: </Text>
              <Text>{currentIdentity.profile.title}</Text>
            </Box>
          )}
          {currentIdentity.profile.company && (
            <Box marginLeft={2}>
              <Text dimColor>Company: </Text>
              <Text>{currentIdentity.profile.company}</Text>
            </Box>
          )}
          <Box marginLeft={2}>
            <Text dimColor>Timezone: </Text>
            <Text>{currentIdentity.profile.timezone}</Text>
          </Box>

          <Box marginTop={1} marginBottom={1}>
            <Text bold>Preferences</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>Language: </Text>
            <Text>{currentIdentity.preferences.language}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>Style: </Text>
            <Text>{currentIdentity.preferences.communicationStyle}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>Response: </Text>
            <Text>{currentIdentity.preferences.responseLength}</Text>
          </Box>

          {currentIdentity.context && (
            <>
              <Box marginTop={1} marginBottom={1}>
                <Text bold>Context</Text>
              </Box>
              <Box marginLeft={2}>
                <Text dimColor>{currentIdentity.context.slice(0, 200)}...</Text>
              </Box>
            </>
          )}
        </Box>

        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            {!isActive && 's switch | '}
            {!currentIdentity.isDefault && 'd set default | '}
            x delete | Esc back
          </Text>
        </Box>
      </Box>
    );
  }

  // List view (default)
  const visibleIdentities = identities.slice(identityRange.start, identityRange.end);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Identities</Text>
        {identities.length > MAX_VISIBLE_ITEMS && (
          <Text dimColor> ({identityIndex + 1}/{identities.length})</Text>
        )}
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        {identityRange.hasMore.above > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↑ {identityRange.hasMore.above} more above</Text>
          </Box>
        )}

        {visibleIdentities.map((identity, visibleIdx) => {
          const actualIdx = identityRange.start + visibleIdx;
          const isSelected = actualIdx === identityIndex;
          const isActive = identity.id === activeIdentityId;
          const prefix = isSelected ? '> ' : '  ';
          const nameDisplay = identity.name.padEnd(20);
          const statusIcon = identity.isDefault ? '★' : isActive ? '●' : '○';
          const statusColor = identity.isDefault ? 'yellow' : isActive ? 'green' : 'gray';

          return (
            <Box key={identity.id} paddingY={0}>
              <Text inverse={isSelected} dimColor={!isSelected}>
                {prefix}
              </Text>
              <Text color={statusColor} inverse={isSelected}>
                {statusIcon}
              </Text>
              <Text inverse={isSelected} dimColor={!isSelected}>
                {' '}{nameDisplay}
              </Text>
              <Text inverse={isSelected} dimColor>
                {' '}{identity.profile.displayName}
              </Text>
            </Box>
          );
        })}

        {identityRange.hasMore.below > 0 && (
          <Box paddingY={0}>
            <Text dimColor>  ↓ {identityRange.hasMore.below} more below</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Legend: </Text>
        <Text color="yellow">★</Text>
        <Text dimColor> default | </Text>
        <Text color="green">●</Text>
        <Text dimColor> active | </Text>
        <Text color="gray">○</Text>
        <Text dimColor> inactive</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select | Enter view | n new | q quit
        </Text>
      </Box>
    </Box>
  );
}

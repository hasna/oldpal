import React from 'react';
import { Box, Text } from 'ink';

interface PanelHeaderProps {
  title: string;
  color?: string;
  count?: number;
  hints?: string;
}

/**
 * Standardized panel header component.
 * All panels should use this for consistent header formatting.
 */
export function PanelHeader({ title, color = 'cyan', count, hints }: PanelHeaderProps) {
  return (
    <Box borderStyle="single" borderColor={color} paddingX={1} marginBottom={1}>
      <Text bold color={color}>{title}</Text>
      {count !== undefined && (
        <Text color="gray"> ({count})</Text>
      )}
      {hints && (
        <>
          <Text color="gray"> | </Text>
          <Text color="gray">{hints}</Text>
        </>
      )}
    </Box>
  );
}

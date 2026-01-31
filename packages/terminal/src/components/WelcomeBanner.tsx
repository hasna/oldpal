import React from 'react';
import { Box, Text } from 'ink';

interface WelcomeBannerProps {
  version: string;
  model: string;
  directory: string;
}

export function WelcomeBanner({ version, model, directory }: WelcomeBannerProps) {
  // Shorten directory for display
  const homeDir = process.env.HOME || '';
  const displayDir = directory.startsWith(homeDir)
    ? '~' + directory.slice(homeDir.length)
    : directory;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan" bold>{'>'}</Text>
        <Text color="cyan" bold>_ </Text>
        <Text bold>oldpal</Text>
        <Text dimColor> (v{version})</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>model:     </Text>
        <Text>{model}</Text>
        <Text dimColor>     /model to change</Text>
      </Box>
      <Box>
        <Text dimColor>directory: </Text>
        <Text>{displayDir}</Text>
      </Box>
    </Box>
  );
}

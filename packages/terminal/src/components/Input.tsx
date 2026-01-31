import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

// Available commands with descriptions
const COMMANDS = [
  { name: '/help', description: 'show available commands' },
  { name: '/clear', description: 'clear the conversation' },
  { name: '/new', description: 'start a new conversation' },
  { name: '/session', description: 'list/switch sessions (Ctrl+S)' },
  { name: '/status', description: 'show session status' },
  { name: '/tokens', description: 'show token usage' },
  { name: '/cost', description: 'show estimated API cost' },
  { name: '/model', description: 'show model information' },
  { name: '/skills', description: 'list available skills' },
  { name: '/config', description: 'show configuration' },
  { name: '/init', description: 'initialize oldpal in project' },
  { name: '/compact', description: 'summarize to save context' },
  { name: '/memory', description: 'show what AI remembers' },
  { name: '/bug', description: 'analyze and fix a bug' },
  { name: '/pr', description: 'create a pull request' },
  { name: '/review', description: 'review code changes' },
  { name: '/exit', description: 'exit oldpal' },
];

interface SkillInfo {
  name: string;
  description: string;
  argumentHint?: string;
}

interface InputProps {
  onSubmit: (value: string, mode: 'normal' | 'interrupt' | 'queue') => void;
  isProcessing?: boolean;
  queueLength?: number;
  commands?: { name: string; description: string }[];
  skills?: SkillInfo[];
}

export function Input({ onSubmit, isProcessing, queueLength = 0, commands, skills = [] }: InputProps) {
  const [value, setValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Merge built-in commands with passed commands
  const allCommands = useMemo(() => {
    const merged = [...COMMANDS];
    if (commands) {
      for (const cmd of commands) {
        if (!merged.find(c => c.name === cmd.name)) {
          merged.push(cmd);
        }
      }
    }
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [commands]);

  // Determine autocomplete mode
  const autocompleteMode = useMemo(() => {
    if (value.startsWith('$') && !value.includes(' ')) {
      return 'skill';
    }
    if (value.startsWith('/') && !value.includes(' ')) {
      return 'command';
    }
    return null;
  }, [value]);

  // Filter commands based on input
  const filteredCommands = useMemo(() => {
    if (autocompleteMode !== 'command') return [];
    const search = value.toLowerCase();
    return allCommands.filter(cmd => cmd.name.toLowerCase().startsWith(search));
  }, [value, autocompleteMode, allCommands]);

  // Filter skills based on input
  const filteredSkills = useMemo(() => {
    if (autocompleteMode !== 'skill') return [];
    const search = value.slice(1).toLowerCase(); // Remove $ prefix
    return skills.filter(skill => skill.name.toLowerCase().startsWith(search));
  }, [value, autocompleteMode, skills]);

  // Combined items for selection
  const autocompleteItems = autocompleteMode === 'skill' ? filteredSkills : filteredCommands;

  // Handle keyboard input for autocomplete
  useInput((input, key) => {
    // Tab: autocomplete selected item
    if (key.tab && autocompleteItems.length > 0) {
      const selected = autocompleteItems[selectedIndex] || autocompleteItems[0];
      if (autocompleteMode === 'skill') {
        setValue('$' + selected.name + ' ');
      } else {
        setValue(selected.name + ' ');
      }
      setSelectedIndex(0);
      return;
    }

    // Arrow keys for autocomplete navigation
    if (autocompleteItems.length > 0) {
      if (key.downArrow) {
        setSelectedIndex(prev => Math.min(prev + 1, autocompleteItems.length - 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }
    }

    // Submit modes
    if (!value.trim()) return;

    // Shift+Enter or Ctrl+Enter: interrupt and send immediately
    if ((key.shift || key.ctrl) && key.return) {
      onSubmit(value, 'interrupt');
      setValue('');
      setSelectedIndex(0);
    }
    // Alt+Enter: queue message
    else if (key.meta && key.return) {
      onSubmit(value, 'queue');
      setValue('');
      setSelectedIndex(0);
    }
  });

  const handleChange = (newValue: string) => {
    setValue(newValue);
    setSelectedIndex(0); // Reset selection when typing
  };

  const handleSubmit = (submittedValue: string) => {
    if (!submittedValue.trim()) return;

    // Normal submit: queue if processing, send otherwise
    if (isProcessing) {
      onSubmit(submittedValue, 'queue');
    } else {
      onSubmit(submittedValue, 'normal');
    }
    setValue('');
    setSelectedIndex(0);
  };

  // Show different prompts based on state
  let prompt = '❯';
  let placeholder = 'Type a message...';

  if (isProcessing) {
    prompt = '⋯';
    placeholder = queueLength > 0 ? 'Type to queue another...' : 'Type to queue (Enter) or interrupt (Shift+Enter)...';
  }

  // Truncate description to fit in terminal
  const truncateDescription = (desc: string, maxLen: number = 60) => {
    if (desc.length <= maxLen) return desc;
    return desc.slice(0, maxLen - 3) + '...';
  };

  // Autocomplete dropdown settings
  const maxVisible = 8;

  // Calculate visible window for scrolling
  const getVisibleItems = <T extends { name: string }>(items: T[]): { items: T[]; startIndex: number } => {
    if (items.length <= maxVisible) {
      return { items, startIndex: 0 };
    }

    // Keep selected item in view with some context
    let startIndex = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
    startIndex = Math.min(startIndex, items.length - maxVisible);

    return {
      items: items.slice(startIndex, startIndex + maxVisible),
      startIndex,
    };
  };

  const visibleSkills = getVisibleItems(filteredSkills);
  const visibleCommands = getVisibleItems(filteredCommands);

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Input line */}
      <Box>
        <Text dimColor={isProcessing}>{prompt} </Text>
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      </Box>

      {/* Skills autocomplete dropdown - below input */}
      {autocompleteMode === 'skill' && filteredSkills.length > 0 && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {/* Scroll indicator - top */}
          {visibleSkills.startIndex > 0 && (
            <Text dimColor>  ↑ {visibleSkills.startIndex} more above</Text>
          )}
          {visibleSkills.items.map((skill, i) => {
            const actualIndex = visibleSkills.startIndex + i;
            return (
              <Box key={skill.name}>
                <Text color={actualIndex === selectedIndex ? 'cyan' : '#5fb3a1'}>
                  {actualIndex === selectedIndex ? '▸ ' : '  '}
                  {skill.name.padEnd(18)}
                </Text>
                <Text dimColor={actualIndex !== selectedIndex}>
                  {truncateDescription(skill.description)}
                </Text>
              </Box>
            );
          })}
          {/* Scroll indicator - bottom */}
          {visibleSkills.startIndex + maxVisible < filteredSkills.length && (
            <Text dimColor>  ↓ {filteredSkills.length - visibleSkills.startIndex - maxVisible} more below</Text>
          )}
        </Box>
      )}

      {/* Commands autocomplete dropdown - below input */}
      {autocompleteMode === 'command' && filteredCommands.length > 0 && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {/* Scroll indicator - top */}
          {visibleCommands.startIndex > 0 && (
            <Text dimColor>  ↑ {visibleCommands.startIndex} more above</Text>
          )}
          {visibleCommands.items.map((cmd, i) => {
            const actualIndex = visibleCommands.startIndex + i;
            return (
              <Box key={cmd.name}>
                <Text color={actualIndex === selectedIndex ? 'cyan' : undefined}>
                  {actualIndex === selectedIndex ? '▸ ' : '  '}
                  {cmd.name.padEnd(14)}
                </Text>
                <Text dimColor={actualIndex !== selectedIndex}>
                  {cmd.description}
                </Text>
              </Box>
            );
          })}
          {/* Scroll indicator - bottom */}
          {visibleCommands.startIndex + maxVisible < filteredCommands.length && (
            <Text dimColor>  ↓ {filteredCommands.length - visibleCommands.startIndex - maxVisible} more below</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

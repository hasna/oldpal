import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { buildLayout, moveCursorVertical, type InputLayout } from './inputLayout';

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
  { name: '/skill', description: 'create or manage skills' },
  { name: '/config', description: 'show configuration' },
  { name: '/projects', description: 'manage projects in this folder' },
  { name: '/plans', description: 'manage project plans' },
  { name: '/connectors', description: 'list available connectors' },
  { name: '/init', description: 'initialize assistants in project' },
  { name: '/compact', description: 'summarize to save context' },
  { name: '/memory', description: 'show what AI remembers' },
  { name: '/context', description: 'manage injected project context' },
  { name: '/feedback', description: 'submit feedback on GitHub' },
  { name: '/schedule', description: 'schedule a command' },
  { name: '/schedules', description: 'list scheduled commands' },
  { name: '/unschedule', description: 'delete a scheduled command' },
  { name: '/pause', description: 'pause a scheduled command' },
  { name: '/resume', description: 'resume a scheduled command' },
  { name: '/exit', description: 'exit assistants' },
];

interface SkillInfo {
  name: string;
  description: string;
  argumentHint?: string;
}

interface InputProps {
  onSubmit: (value: string, mode: 'normal' | 'interrupt' | 'queue' | 'inline') => void;
  isProcessing?: boolean;
  queueLength?: number;
  commands?: { name: string; description: string }[];
  skills?: SkillInfo[];
  isAskingUser?: boolean;
  askPlaceholder?: string;
}

export function Input({
  onSubmit,
  isProcessing,
  queueLength = 0,
  commands,
  skills = [],
  isAskingUser = false,
  askPlaceholder,
}: InputProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [preferredColumn, setPreferredColumn] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { stdout } = useStdout();
  const screenWidth = stdout?.columns ?? 80;
  const terminalWidth = Math.max(10, screenWidth - 2);
  const textWidth = Math.max(10, screenWidth - 4);

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
    if (isAskingUser) return null;
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

  // Keep selected index in range when list size changes
  useEffect(() => {
    if (autocompleteItems.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((prev) => Math.min(prev, autocompleteItems.length - 1));
  }, [autocompleteItems.length]);

  const setValueAndCursor = (nextValue: string, nextCursor: number = nextValue.length) => {
    setValue(nextValue);
    const clamped = Math.max(0, Math.min(nextCursor, nextValue.length));
    setCursor(clamped);
    setPreferredColumn(null);
    setSelectedIndex(0);
  };


  const handleSubmit = (submittedValue: string) => {
    if (!submittedValue.trim()) return;

    if (
      autocompleteMode === 'command' &&
      filteredCommands.length > 0 &&
      !submittedValue.includes(' ')
    ) {
      const selected = filteredCommands[selectedIndex] || filteredCommands[0];
      if (selected) {
        onSubmit(selected.name, isProcessing ? 'inline' : 'normal');
        setValueAndCursor('');
        return;
      }
    }

    if (isProcessing) {
      onSubmit(submittedValue, 'inline');
    } else {
      onSubmit(submittedValue, 'normal');
    }
    setValueAndCursor('');
  };

  const moveCursorTo = (next: number, resetPreferred: boolean = true) => {
    const clamped = Math.max(0, Math.min(next, value.length));
    setCursor(clamped);
    if (resetPreferred) {
      setPreferredColumn(null);
    }
  };

  const moveCursorBy = (delta: number) => {
    moveCursorTo(cursor + delta);
  };

  const applyVerticalMove = (currentLayout: InputLayout, direction: -1 | 1) => {
    const result = moveCursorVertical(currentLayout, preferredColumn, direction);
    if (!result) return;
    setCursor(result.cursor);
    setPreferredColumn(result.preferredColumn);
  };

  const insertText = (text: string) => {
    if (!text) return;
    const next = value.slice(0, cursor) + text + value.slice(cursor);
    setValue(next);
    setCursor(cursor + text.length);
    setPreferredColumn(null);
    setSelectedIndex(0);
  };

  const deleteBackward = () => {
    if (cursor === 0) return;
    const next = value.slice(0, cursor - 1) + value.slice(cursor);
    setValue(next);
    setCursor(cursor - 1);
    setPreferredColumn(null);
    setSelectedIndex(0);
  };

  const deleteForward = () => {
    if (cursor >= value.length) return;
    const next = value.slice(0, cursor) + value.slice(cursor + 1);
    setValue(next);
    setPreferredColumn(null);
    setSelectedIndex(0);
  };

  // Handle keyboard input for autocomplete and editing
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (value.length > 0) {
        setValueAndCursor('');
      }
      return;
    }

    if (!isAskingUser) {
      // Tab: autocomplete selected item
      if (key.tab) {
        if (autocompleteItems.length > 0) {
          const selected = autocompleteItems[selectedIndex] || autocompleteItems[0];
          const nextValue = autocompleteMode === 'skill'
            ? `$${selected.name} `
            : `${selected.name} `;
          setValueAndCursor(nextValue);
          return;
        }
        if (isProcessing && value.trim()) {
          onSubmit(value, 'queue');
          setValueAndCursor('');
          return;
        }
      }

      // Arrow keys for autocomplete navigation
      if (autocompleteItems.length > 0) {
        if (key.downArrow) {
          setSelectedIndex((prev) => Math.min(prev + 1, autocompleteItems.length - 1));
          return;
        }
        if (key.upArrow) {
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          return;
        }
      }
    }

    const activeLayout = buildLayout(value, cursor, textWidth);

    if (key.leftArrow) {
      moveCursorBy(-1);
      return;
    }
    if (key.rightArrow) {
      moveCursorBy(1);
      return;
    }
    if (key.upArrow) {
      applyVerticalMove(activeLayout, -1);
      return;
    }
    if (key.downArrow) {
      applyVerticalMove(activeLayout, 1);
      return;
    }
    if (key.home) {
      const line = activeLayout.displayLines[activeLayout.cursorRow];
      moveCursorTo(line.start, false);
      return;
    }
    if (key.end) {
      const line = activeLayout.displayLines[activeLayout.cursorRow];
      moveCursorTo(line.start + line.text.length, false);
      return;
    }
    // Handle backspace - Ink 6.x sets key.delete (not key.backspace) for \x7f (DEL)
    // which is what macOS/Linux terminals send for the Backspace key.
    // The actual Delete/Forward-Delete key sends \x1b[3~ escape sequence.
    if (key.backspace || key.delete) {
      deleteBackward();
      return;
    }
    // Handle forward delete key (Fn+Backspace on Mac, Delete on full keyboards)
    // This key sends the \x1b[3~ escape sequence, not \x7f
    if (input === '\x1b[3~') {
      deleteForward();
      return;
    }

    if (key.return) {
      // Shift+Enter or Ctrl+Enter: interrupt and send immediately
      if ((key.shift || key.ctrl) && value.trim()) {
        onSubmit(value, 'interrupt');
        setValueAndCursor('');
        return;
      }
      // Meta+Enter: queue message
      if (key.meta && value.trim()) {
        onSubmit(value, 'queue');
        setValueAndCursor('');
        return;
      }
      handleSubmit(value);
      setValueAndCursor('');
      return;
    }

    // Insert printable characters only (filter out control characters and DEL)
    const charCode = input?.charCodeAt(0) ?? 0;
    if (input && charCode >= 32 && charCode !== 127) {
      insertText(input);
    }
  });

  // Show different prompts based on state
  let placeholder = 'Type a message...';

  if (isAskingUser) {
    placeholder = askPlaceholder || 'Answer the question...';
  } else if (isProcessing) {
    placeholder = queueLength > 0
      ? 'Type to queue (Tab) or interrupt (Shift+Enter)...'
      : 'Type to interrupt (Shift+Enter)...';
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

  const layout = buildLayout(value, cursor, textWidth);
  const lines = layout.displayLines;
  const lineCount = value.split('\n').length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Top border */}
      <Box>
        <Text color="#666666">{'-'.repeat(terminalWidth)}</Text>
      </Box>

      {/* Input area */}
      <Box paddingY={0} flexDirection="column">
        {value.length === 0 ? (
          <Box>
            <Text color={isProcessing ? 'gray' : 'cyan'}>&gt; </Text>
            <Box flexGrow={1}>
              <Text inverse> </Text>
              <Text dimColor>{placeholder}</Text>
            </Box>
          </Box>
        ) : (
          lines.map((line, index) => {
            const isCursorLine = index === layout.cursorRow;
            if (!isCursorLine) {
              return (
                <Box key={`line-${index}`}>
                  <Text color={isProcessing ? 'gray' : 'cyan'}>{index === 0 ? '> ' : '  '}</Text>
                  <Box flexGrow={1}>
                    <Text>{line.text || ' '}</Text>
                  </Box>
                </Box>
              );
            }
            const column = Math.min(layout.cursorCol, line.text.length);
            const before = line.text.slice(0, column);
            const cursorChar = column < line.text.length ? line.text[column] : ' ';
            const after = column < line.text.length ? line.text.slice(column + 1) : '';
            return (
              <Box key={`line-${index}`}>
                <Text color={isProcessing ? 'gray' : 'cyan'}>{index === 0 ? '> ' : '  '}</Text>
                <Box flexGrow={1}>
                  <Text>{before}</Text>
                  <Text inverse>{cursorChar}</Text>
                  <Text>{after}</Text>
                </Box>
              </Box>
            );
          })
        )}
      </Box>

      {/* Show line count if multiline */}
      {lineCount > 1 && (
        <Box marginLeft={2}>
          <Text color="gray">({lineCount} lines)</Text>
        </Box>
      )}

      {/* Bottom border */}
      <Box>
        <Text color="#666666">{'-'.repeat(terminalWidth)}</Text>
      </Box>

      {isProcessing && !isAskingUser && (
        <Box marginLeft={2}>
          <Text dimColor>[esc] stop</Text>
        </Box>
      )}

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

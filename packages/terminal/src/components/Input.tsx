import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { buildLayout, moveCursorVertical, type InputLayout } from './inputLayout';

// Available commands with descriptions
const COMMANDS = [
  { name: '/help', description: 'show available commands' },
  { name: '/clear', description: 'clear the conversation' },
  { name: '/new', description: 'start a new conversation' },
  { name: '/session', description: 'list/switch sessions (Ctrl+])' },
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
  allowBlankAnswer?: boolean;
}

export function Input({
  onSubmit,
  isProcessing,
  queueLength = 0,
  commands,
  skills = [],
  isAskingUser = false,
  askPlaceholder,
  allowBlankAnswer = false,
}: InputProps) {
  // Combined value+cursor state for atomic updates during rapid paste operations
  // When text is pasted, it may arrive in multiple chunks; using a single state
  // object ensures each chunk sees the correct previous state via functional updates
  const [inputState, setInputState] = useState({ value: '', cursor: 0 });
  const { value, cursor } = inputState;

  // Helpers for setting value/cursor together (atomic) or separately
  const setValue = (newValue: string | ((prev: string) => string)) => {
    setInputState(prev => ({
      ...prev,
      value: typeof newValue === 'function' ? newValue(prev.value) : newValue,
    }));
  };
  const setCursor = (newCursor: number | ((prev: number) => number)) => {
    setInputState(prev => ({
      ...prev,
      cursor: typeof newCursor === 'function' ? newCursor(prev.cursor) : newCursor,
    }));
  };

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
  }, [value, isAskingUser]);

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
    const clamped = Math.max(0, Math.min(nextCursor, nextValue.length));
    setInputState({ value: nextValue, cursor: clamped });
    setPreferredColumn(null);
    setSelectedIndex(0);
  };


  const handleSubmit = (submittedValue: string) => {
    // Allow blank submission only for optional ask-user questions
    if (!submittedValue.trim() && !allowBlankAnswer) return;

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
    // Use functional update for atomic value+cursor change during rapid pastes
    setInputState(prev => ({
      value: prev.value.slice(0, prev.cursor) + text + prev.value.slice(prev.cursor),
      cursor: prev.cursor + text.length,
    }));
    setPreferredColumn(null);
    setSelectedIndex(0);
  };

  const deleteBackward = () => {
    setInputState(prev => {
      if (prev.cursor === 0) return prev;
      return {
        value: prev.value.slice(0, prev.cursor - 1) + prev.value.slice(prev.cursor),
        cursor: prev.cursor - 1,
      };
    });
    setPreferredColumn(null);
    setSelectedIndex(0);
  };

  const deleteForward = () => {
    setInputState(prev => {
      if (prev.cursor >= prev.value.length) return prev;
      return {
        value: prev.value.slice(0, prev.cursor) + prev.value.slice(prev.cursor + 1),
        cursor: prev.cursor,
      };
    });
    setPreferredColumn(null);
    setSelectedIndex(0);
  };

  // Delete word backward (Ctrl+W) - standard terminal/readline behavior
  const deleteWordBackward = () => {
    setInputState(prev => {
      if (prev.cursor === 0) return prev;

      let start = prev.cursor - 1;

      // Skip trailing spaces/whitespace
      while (start >= 0 && /\s/.test(prev.value[start])) {
        start--;
      }

      // Find start of word (stop at space or beginning)
      while (start >= 0 && !/\s/.test(prev.value[start])) {
        start--;
      }

      // start is now at the space before the word (or -1 if at beginning)
      return {
        value: prev.value.slice(0, start + 1) + prev.value.slice(prev.cursor),
        cursor: start + 1,
      };
    });
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

    // Ctrl+W: delete word backward (standard readline behavior)
    if (key.ctrl && input === 'w') {
      deleteWordBackward();
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
    // Handle backspace - multiple terminal variations:
    // - \x7f (DEL, ASCII 127) - what most modern terminals send for Backspace
    // - \x08 (BS, ASCII 8) - traditional backspace, some terminals still use this
    // - Ink sets key.delete for \x7f on Mac/Linux, key.backspace varies by terminal
    // We check raw codes first for cross-terminal reliability
    if (input === '\x7f' || input === '\x08' || key.backspace || key.delete) {
      deleteBackward();
      return;
    }
    // Handle forward delete key (Fn+Backspace on Mac, Delete on full keyboards)
    // This key sends the \x1b[3~ escape sequence, not \x7f
    if (input === '\x1b[3~') {
      deleteForward();
      return;
    }

    // Alt+Enter sends ESC + carriage return in most terminals
    // Handle this before the return key check to insert newline
    if (input === '\x1b\r' || input === '\x1b\n') {
      insertText('\n');
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

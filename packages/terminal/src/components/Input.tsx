import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface InputProps {
  onSubmit: (value: string, mode: 'normal' | 'interrupt' | 'queue') => void;
  isProcessing?: boolean;
  queueLength?: number;
}

export function Input({ onSubmit, isProcessing, queueLength = 0 }: InputProps) {
  const [value, setValue] = useState('');

  // Handle different submit modes
  useInput((input, key) => {
    if (!value.trim()) return;

    // Shift+Enter or Ctrl+Enter: interrupt and send immediately
    if ((key.shift || key.ctrl) && key.return) {
      onSubmit(value, 'interrupt');
      setValue('');
    }
    // Alt+Enter: queue message
    else if (key.meta && key.return) {
      onSubmit(value, 'queue');
      setValue('');
    }
  });

  const handleSubmit = (submittedValue: string) => {
    if (!submittedValue.trim()) return;

    // Normal submit: queue if processing, send otherwise
    if (isProcessing) {
      onSubmit(submittedValue, 'queue');
    } else {
      onSubmit(submittedValue, 'normal');
    }
    setValue('');
  };

  // Show different prompts based on state
  let prompt = '❯';
  let placeholder = 'Type a message...';

  if (isProcessing) {
    prompt = '⋯';
    placeholder = queueLength > 0 ? 'Type to queue another...' : 'Type to queue (Enter) or interrupt (Shift+Enter)...';
  }

  return (
    <Box marginTop={1}>
      <Text dimColor={isProcessing}>{prompt} </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder={placeholder}
      />
    </Box>
  );
}

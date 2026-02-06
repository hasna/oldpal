import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { HookEvent, HookHandler } from '@hasna/assistants-shared';
import type { HookLocation } from '@hasna/assistants-core';

interface HookWizardProps {
  onSave: (event: HookEvent, handler: HookHandler, location: HookLocation, matcher?: string) => Promise<void>;
  onCancel: () => void;
}

const HOOK_EVENTS: HookEvent[] = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'SubassistantStart',
  'SubassistantStop',
  'PreCompact',
  'Notification',
  'Stop',
];

const HOOK_TYPES = ['command', 'prompt', 'assistant'] as const;
type HookType = typeof HOOK_TYPES[number];

const HOOK_LOCATIONS: HookLocation[] = ['project', 'user', 'local'];

type Step = 'event' | 'matcher' | 'type' | 'command' | 'timeout' | 'async' | 'name' | 'location' | 'confirm';

export function HookWizard({ onSave, onCancel }: HookWizardProps) {
  // Form state
  const [event, setEvent] = useState<HookEvent>('PreToolUse');
  const [matcher, setMatcher] = useState('');
  const [hookType, setHookType] = useState<HookType>('command');
  const [command, setCommand] = useState('');
  const [timeout, setTimeout] = useState('30000');
  const [isAsync, setIsAsync] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<HookLocation>('project');

  // Navigation state
  const [step, setStep] = useState<Step>('event');
  const [eventIndex, setEventIndex] = useState(0);
  const [typeIndex, setTypeIndex] = useState(0);
  const [locationIndex, setLocationIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    // Global escape to cancel
    if (key.escape) {
      if (step === 'event') {
        onCancel();
      } else {
        // Go back to previous step
        goBack();
      }
      return;
    }

    // Handle each step
    switch (step) {
      case 'event':
        handleEventInput(input, key);
        break;
      case 'matcher':
        // TextInput handles this
        break;
      case 'type':
        handleTypeInput(input, key);
        break;
      case 'command':
        // TextInput handles this
        break;
      case 'timeout':
        // TextInput handles this
        break;
      case 'async':
        handleAsyncInput(input, key);
        break;
      case 'name':
        // TextInput handles this
        break;
      case 'location':
        handleLocationInput(input, key);
        break;
      case 'confirm':
        handleConfirmInput(input, key);
        break;
    }
  }, { isActive: !['matcher', 'command', 'timeout', 'name'].includes(step) });

  const goBack = () => {
    const steps: Step[] = ['event', 'matcher', 'type', 'command', 'timeout', 'async', 'name', 'location', 'confirm'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
      setError(null);
    }
  };

  const handleEventInput = (input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean }) => {
    if (key.upArrow) {
      setEventIndex((prev) => (prev === 0 ? HOOK_EVENTS.length - 1 : prev - 1));
    } else if (key.downArrow) {
      setEventIndex((prev) => (prev === HOOK_EVENTS.length - 1 ? 0 : prev + 1));
    } else if (key.return) {
      setEvent(HOOK_EVENTS[eventIndex]);
      setStep('matcher');
    }
    // Number keys for quick selection
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= HOOK_EVENTS.length) {
      setEventIndex(num - 1);
    }
  };

  const handleTypeInput = (input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean }) => {
    if (key.upArrow || input === 'k') {
      setTypeIndex((prev) => (prev === 0 ? HOOK_TYPES.length - 1 : prev - 1));
    } else if (key.downArrow || input === 'j') {
      setTypeIndex((prev) => (prev === HOOK_TYPES.length - 1 ? 0 : prev + 1));
    } else if (key.return) {
      setHookType(HOOK_TYPES[typeIndex]);
      setStep('command');
    }
  };

  const handleAsyncInput = (input: string, key: { return: boolean }) => {
    if (input === 'y' || input === 'Y') {
      setIsAsync(true);
      setStep('name');
    } else if (input === 'n' || input === 'N' || key.return) {
      setIsAsync(false);
      setStep('name');
    } else if (input === ' ') {
      setIsAsync(!isAsync);
    }
  };

  const handleLocationInput = (input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean }) => {
    if (key.upArrow) {
      setLocationIndex((prev) => (prev === 0 ? HOOK_LOCATIONS.length - 1 : prev - 1));
    } else if (key.downArrow) {
      setLocationIndex((prev) => (prev === HOOK_LOCATIONS.length - 1 ? 0 : prev + 1));
    } else if (key.return) {
      setLocation(HOOK_LOCATIONS[locationIndex]);
      setStep('confirm');
    }
    // Number keys for quick selection
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= HOOK_LOCATIONS.length) {
      setLocationIndex(num - 1);
    }
  };

  const handleConfirmInput = async (input: string, _key: { return: boolean }) => {
    if (input === 'y' || input === 'Y') {
      await saveHook();
    } else if (input === 'n' || input === 'N') {
      onCancel();
    }
  };

  const saveHook = async () => {
    // Validate
    if (!command.trim()) {
      setError('Command/prompt is required');
      setStep('command');
      return;
    }

    const timeoutNum = parseInt(timeout, 10);
    if (isNaN(timeoutNum) || timeoutNum < 0) {
      setError('Invalid timeout value');
      setStep('timeout');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const handler: HookHandler = {
        type: hookType,
        command: hookType === 'command' ? command.trim() : undefined,
        prompt: hookType !== 'command' ? command.trim() : undefined,
        timeout: timeoutNum > 0 ? timeoutNum : undefined,
        async: isAsync || undefined,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        enabled: true,
      };

      await onSave(event, handler, location, matcher.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save hook');
      setIsSubmitting(false);
    }
  };

  const handleMatcherSubmit = () => {
    setStep('type');
  };

  const handleCommandSubmit = () => {
    if (!command.trim()) {
      setError(hookType === 'command' ? 'Command is required' : 'Prompt is required');
      return;
    }
    setError(null);
    setStep('timeout');
  };

  const handleTimeoutSubmit = () => {
    const num = parseInt(timeout, 10);
    if (isNaN(num) || num < 0) {
      setError('Invalid timeout value');
      return;
    }
    setError(null);
    setStep('async');
  };

  const handleNameSubmit = () => {
    setStep('location');
  };

  const getLocationDescription = (loc: HookLocation): string => {
    switch (loc) {
      case 'user':
        return '~/.assistants/hooks.json (all projects)';
      case 'project':
        return '.assistants/hooks.json (this project)';
      case 'local':
        return '.assistants/hooks.local.json (gitignored)';
      default:
        return '';
    }
  };

  // Render step content
  const renderStep = () => {
    switch (step) {
      case 'event':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">Step 1/8: Select Event</Text>
            </Box>
            <Text dimColor>When should this hook run?</Text>
            <Box
              flexDirection="column"
              marginTop={1}
              borderStyle="round"
              borderColor="gray"
              paddingX={1}
              height={Math.min(10, HOOK_EVENTS.length + 2)}
            >
              {HOOK_EVENTS.map((ev, index) => (
                <Box key={ev}>
                  <Text
                    inverse={index === eventIndex}
                    color={index === eventIndex ? 'cyan' : undefined}
                    dimColor={index !== eventIndex}
                  >
                    {index === eventIndex ? '>' : ' '} {index + 1}. {ev}
                  </Text>
                </Box>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>↑↓ navigate | Enter select | Esc cancel</Text>
            </Box>
          </Box>
        );

      case 'matcher':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">Step 2/8: Matcher Pattern</Text>
            </Box>
            <Text dimColor>Filter which {event} events trigger this hook (regex or exact match)</Text>
            <Text dimColor>Leave empty or use * to match all</Text>
            <Box marginTop={1}>
              <Text>Pattern: </Text>
              <TextInput
                value={matcher}
                onChange={setMatcher}
                onSubmit={handleMatcherSubmit}
                placeholder="Bash|Edit|Write (regex) or * for all"
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter continue | Esc back</Text>
            </Box>
          </Box>
        );

      case 'type':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">Step 3/8: Hook Type</Text>
            </Box>
            <Text dimColor>How should the hook execute?</Text>
            <Box flexDirection="column" marginTop={1}>
              {HOOK_TYPES.map((type, index) => (
                <Box key={type}>
                  <Text
                    inverse={index === typeIndex}
                    color={index === typeIndex ? 'cyan' : undefined}
                    dimColor={index !== typeIndex}
                  >
                    {index === typeIndex ? '>' : ' '} {type === 'command' ? 'command  ' : type === 'prompt' ? 'prompt   ' : 'assistant'}
                    <Text dimColor>
                      {type === 'command' && ' - Run a shell command'}
                      {type === 'prompt' && ' - Single-turn LLM decision'}
                      {type === 'assistant' && ' - Multi-turn assistant with tools'}
                    </Text>
                  </Text>
                </Box>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>↑↓ navigate | Enter select | Esc back</Text>
            </Box>
          </Box>
        );

      case 'command':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">Step 4/8: {hookType === 'command' ? 'Command' : 'Prompt'}</Text>
            </Box>
            {hookType === 'command' ? (
              <>
                <Text dimColor>Shell command to run. Input is passed as JSON via stdin.</Text>
                <Text dimColor>Exit 0 = allow, Exit 2 = block, other = error</Text>
              </>
            ) : (
              <>
                <Text dimColor>Prompt to send to the LLM. Context will be appended.</Text>
                <Text dimColor>LLM should respond with {"{"}&quot;allow&quot;: boolean, &quot;reason&quot;: string{"}"}</Text>
              </>
            )}
            <Box marginTop={1}>
              <Text>{hookType === 'command' ? 'Command' : 'Prompt'}: </Text>
              <TextInput
                value={command}
                onChange={(v) => { setCommand(v); setError(null); }}
                onSubmit={handleCommandSubmit}
                placeholder={hookType === 'command' ? './scripts/validate.sh' : 'Should this action be allowed?'}
              />
            </Box>
            {error && (
              <Box marginTop={1}>
                <Text color="red">{error}</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text dimColor>Enter continue | Esc back</Text>
            </Box>
          </Box>
        );

      case 'timeout':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">Step 5/8: Timeout</Text>
            </Box>
            <Text dimColor>Maximum time to wait for hook to complete (milliseconds)</Text>
            <Box marginTop={1}>
              <Text>Timeout: </Text>
              <TextInput
                value={timeout}
                onChange={(v) => { setTimeout(v); setError(null); }}
                onSubmit={handleTimeoutSubmit}
                placeholder="30000"
              />
              <Text dimColor> ms</Text>
            </Box>
            {error && (
              <Box marginTop={1}>
                <Text color="red">{error}</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text dimColor>Enter continue | Esc back</Text>
            </Box>
          </Box>
        );

      case 'async':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">Step 6/8: Async Execution</Text>
            </Box>
            <Text dimColor>Run in background without blocking?</Text>
            <Box marginTop={1}>
              <Text>Run async: </Text>
              <Text color={isAsync ? 'green' : 'gray'}>[{isAsync ? 'Yes' : 'No '}]</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>y yes | n no | Space toggle | Enter continue | Esc back</Text>
            </Box>
          </Box>
        );

      case 'name':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">Step 7/8: Name & Description (optional)</Text>
            </Box>
            <Text dimColor>Give your hook a friendly name</Text>
            <Box marginTop={1}>
              <Text>Name: </Text>
              <TextInput
                value={name}
                onChange={setName}
                onSubmit={handleNameSubmit}
                placeholder="Validate dangerous commands"
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter continue | Esc back</Text>
            </Box>
          </Box>
        );

      case 'location':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">Step 8/8: Save Location</Text>
            </Box>
            <Text dimColor>Where should this hook be stored?</Text>
            <Box flexDirection="column" marginTop={1}>
              {HOOK_LOCATIONS.map((loc, index) => (
                <Box key={loc}>
                  <Text
                    inverse={index === locationIndex}
                    color={index === locationIndex ? 'cyan' : undefined}
                    dimColor={index !== locationIndex}
                  >
                    {index === locationIndex ? '>' : ' '} {loc.padEnd(8)}
                    <Text dimColor> {getLocationDescription(loc)}</Text>
                  </Text>
                </Box>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>↑↓ navigate | Enter select | Esc back</Text>
            </Box>
          </Box>
        );

      case 'confirm':
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="cyan">Confirm Hook</Text>
            </Box>
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
              <Box><Text dimColor>Event:   </Text><Text bold>{event}</Text></Box>
              <Box><Text dimColor>Matcher: </Text><Text>{matcher || '*'}</Text></Box>
              <Box><Text dimColor>Type:    </Text><Text>{hookType}</Text></Box>
              <Box><Text dimColor>{hookType === 'command' ? 'Command' : 'Prompt'}:</Text><Text> {command.slice(0, 40)}{command.length > 40 ? '...' : ''}</Text></Box>
              <Box><Text dimColor>Timeout: </Text><Text>{timeout}ms</Text></Box>
              <Box><Text dimColor>Async:   </Text><Text>{isAsync ? 'Yes' : 'No'}</Text></Box>
              {name && <Box><Text dimColor>Name:    </Text><Text>{name}</Text></Box>}
              <Box><Text dimColor>Location:</Text><Text> {location}</Text></Box>
            </Box>
            {error && (
              <Box marginTop={1}>
                <Text color="red">{error}</Text>
              </Box>
            )}
            {isSubmitting ? (
              <Box marginTop={1}>
                <Text color="yellow">Saving hook...</Text>
              </Box>
            ) : (
              <Box marginTop={1}>
                <Text>
                  Press <Text color="green" bold>y</Text> to save or{' '}
                  <Text color="red" bold>n</Text> to cancel
                </Text>
              </Box>
            )}
          </Box>
        );
      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Add Hook</Text>
      </Box>
      {renderStep()}
    </Box>
  );
}

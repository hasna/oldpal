import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useStdin } from 'ink';
import TextInput from 'ink-text-input';
import { useSafeInput as useInput } from '../hooks/useSafeInput';
import { useTypewriter } from '../hooks/useTypewriter';
import { useGradientCycle } from '../hooks/useGradientCycle';

// ============================================
// Types
// ============================================

export interface OnboardingResult {
  apiKey: string;
  model: string;
  connectors: string[];
  connectorKeys: Record<string, string>;
}

interface OnboardingPanelProps {
  onComplete: (result: OnboardingResult) => Promise<void>;
  onCancel: () => void;
  existingApiKey?: string;
  existingModel?: string;
  discoveredConnectors: string[];
}

type Step = 'welcome' | 'intro' | 'api-key' | 'model-select' | 'connectors' | 'connector-keys' | 'summary';

const STEPS: Step[] = ['welcome', 'intro', 'api-key', 'model-select', 'connectors', 'connector-keys', 'summary'];

const MODELS = [
  { id: 'claude-opus-4-5-20251101', label: 'claude-opus-4-5', desc: 'Most capable, best for complex tasks' },
  { id: 'claude-sonnet-4-5-20250929', label: 'claude-sonnet-4-5', desc: 'Fast and capable, great balance' },
  { id: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5', desc: 'Fastest, best for simple tasks' },
];

const POPULAR_CONNECTORS: Record<string, { desc: string; install: string }> = {
  notion: { desc: 'Notion workspace', install: 'bun add -g connect-notion' },
  gmail: { desc: 'Gmail email', install: 'bun add -g connect-gmail' },
  googledrive: { desc: 'Google Drive files', install: 'bun add -g connect-googledrive' },
  slack: { desc: 'Slack messaging', install: 'bun add -g connect-slack' },
  github: { desc: 'GitHub repos & issues', install: 'bun add -g connect-github' },
  calendar: { desc: 'Google Calendar', install: 'bun add -g connect-calendar' },
};

const ASCII_LOGO = `    _    ____ ____ ___ ____ _____  _    _   _ _____ ____
   / \\  / ___/ ___|_ _/ ___|_   _|/ \\  | \\ | |_   _/ ___|
  / _ \\ \\___ \\___ \\| |\\___ \\ | | / _ \\ |  \\| | | | \\___ \\
 / ___ \\ ___) |__) | | ___) || |/ ___ \\| |\\  | | |  ___) |
/_/   \\_\\____/____/___|____/ |_/_/   \\_\\_| \\_| |_| |____/`;

const COMPACT_LOGO = 'ASSISTANTS';

const INTRO_FEATURES = [
  'Chat with Claude AI directly in your terminal',
  'Connect to your tools - Notion, Gmail, Google Drive & more',
  'Learn skills to automate your workflows',
  'Remember context across conversations',
  'Run on schedules and respond to webhooks',
];

// ============================================
// Sub-components
// ============================================

function ProgressBar({ step, total }: { step: number; total: number }) {
  const width = 30;
  const filled = Math.round((step / total) * width);
  const empty = width - filled;
  const pct = Math.round((step / total) * 100);
  return (
    <Box marginBottom={1}>
      <Text color="gray">Step {step} of {total}  [</Text>
      <Text color="cyan">{'='.repeat(filled)}</Text>
      <Text color="gray">{' '.repeat(empty)}</Text>
      <Text color="gray">] {pct}%</Text>
    </Box>
  );
}

function MaskedInput({ value, onChange, onSubmit, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
}) {
  // Show first 7 chars + mask the rest
  const masked = value.length > 7
    ? value.slice(0, 7) + '*'.repeat(Math.min(value.length - 7, 32))
    : value;

  return (
    <Box>
      <Text color="cyan">&gt; </Text>
      {value.length === 0 ? (
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
        />
      ) : (
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
        />
      )}
    </Box>
  );
}

// ============================================
// Main Component
// ============================================

export function OnboardingPanel({
  onComplete,
  onCancel,
  existingApiKey,
  existingModel,
  discoveredConnectors,
}: OnboardingPanelProps) {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [apiKey, setApiKey] = useState(existingApiKey || '');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyValidated, setApiKeyValidated] = useState(!!existingApiKey);
  const [selectedModelIndex, setSelectedModelIndex] = useState(() => {
    if (existingModel) {
      const idx = MODELS.findIndex((m) => m.id === existingModel);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });
  const [enabledConnectors, setEnabledConnectors] = useState<Set<string>>(
    () => new Set(discoveredConnectors)
  );
  const [connectorKeysNeeded] = useState<string[]>([]); // Connectors needing API keys
  const currentStepRef = useRef(currentStep);
  currentStepRef.current = currentStep;

  // Direct stdin listener for Escape — fallback when useSafeInput doesn't receive events
  const { setRawMode, isRawModeSupported } = useStdin();
  useEffect(() => {
    if (isRawModeSupported && setRawMode) {
      setRawMode(true);
    }
    const handleData = (data: Buffer) => {
      const s = data.toString();
      if (s === '\x1b') {
        // Escape key pressed
        if (currentStepRef.current === 'welcome') {
          onCancel();
        }
      }
    };
    process.stdin.on('data', handleData);
    return () => {
      process.stdin.removeListener('data', handleData);
    };
  }, [onCancel, isRawModeSupported, setRawMode]);
  const [connectorKeys, setConnectorKeys] = useState<Record<string, string>>({});
  const [connectorKeyIndex, setConnectorKeyIndex] = useState(0);
  const [connectorKeyValue, setConnectorKeyValue] = useState('');
  const [introRevealCount, setIntroRevealCount] = useState(0);
  const [isCompact, setIsCompact] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const logoColor = useGradientCycle(600);
  const { displayed: subtitle, done: subtitleDone } = useTypewriter(
    'Your personal AI assistant for the terminal.',
    25,
    currentStep === 'welcome'
  );

  // Check terminal width for compact mode
  useEffect(() => {
    const cols = process.stdout.columns || 80;
    setIsCompact(cols < 60);
  }, []);

  // Animate intro bullets
  useEffect(() => {
    if (currentStep !== 'intro') return;
    if (introRevealCount >= INTRO_FEATURES.length) return;

    const timer = setTimeout(() => {
      setIntroRevealCount((prev) => prev + 1);
    }, 400);

    return () => clearTimeout(timer);
  }, [currentStep, introRevealCount]);

  const stepIndex = STEPS.indexOf(currentStep) + 1;

  const goNext = useCallback(() => {
    const idx = STEPS.indexOf(currentStep);
    if (idx < STEPS.length - 1) {
      let nextStep = STEPS[idx + 1];
      // Skip connector-keys step if no keys needed
      if (nextStep === 'connector-keys' && connectorKeysNeeded.length === 0) {
        nextStep = 'summary';
      }
      setCurrentStep(nextStep);
    }
  }, [currentStep, connectorKeysNeeded]);

  const goBack = useCallback(() => {
    const idx = STEPS.indexOf(currentStep);
    if (idx > 0) {
      let prevStep = STEPS[idx - 1];
      // Skip connector-keys step going back too
      if (prevStep === 'connector-keys' && connectorKeysNeeded.length === 0) {
        prevStep = 'connectors';
      }
      setCurrentStep(prevStep);
    }
  }, [currentStep, connectorKeysNeeded]);

  const handleComplete = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onComplete({
        apiKey,
        model: MODELS[selectedModelIndex].id,
        connectors: Array.from(enabledConnectors),
        connectorKeys,
      });
    } finally {
      setIsSaving(false);
    }
  }, [apiKey, selectedModelIndex, enabledConnectors, connectorKeys, onComplete, isSaving]);

  const submitApiKey = useCallback((value: string) => {
    const key = value.trim();
    if (!key && existingApiKey) {
      // Keep existing key
      setApiKey(existingApiKey);
      setApiKeyValidated(true);
      goNext();
      return;
    }
    if (!key) {
      setApiKeyError('API key is required');
      return;
    }
    if (!key.startsWith('sk-ant-')) {
      setApiKeyError('Invalid key format. Anthropic keys start with "sk-ant-"');
      return;
    }
    setApiKeyValidated(true);
    goNext();
  }, [existingApiKey, goNext]);

  const submitConnectorKey = useCallback((value: string) => {
    const currentConnector = connectorKeysNeeded[connectorKeyIndex];
    if (!currentConnector) {
      goNext();
      return;
    }
    const trimmed = value.trim();
    if (trimmed) {
      setConnectorKeys((prev) => ({ ...prev, [currentConnector]: trimmed }));
    }
    setConnectorKeyValue('');
    if (connectorKeyIndex < connectorKeysNeeded.length - 1) {
      setConnectorKeyIndex((prev) => prev + 1);
    } else {
      goNext();
    }
  }, [connectorKeysNeeded, connectorKeyIndex, goNext]);

  // Input handling
  useInput((input, key) => {
    if (key.escape) {
      if (currentStep === 'welcome') {
        onCancel();
      } else {
        goBack();
      }
      return;
    }

    // Step-specific input handling
    switch (currentStep) {
      case 'welcome':
        if (key.return) goNext();
        break;

      case 'intro':
        if (key.return) goNext();
        break;

      case 'api-key':
        // TextInput handles this
        break;

      case 'model-select':
        if (key.upArrow) {
          setSelectedModelIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSelectedModelIndex((prev) => Math.min(MODELS.length - 1, prev + 1));
        } else if (key.return) {
          goNext();
        }
        break;

      case 'connectors': {
        const connectorList = getConnectorDisplayList();
        if (key.upArrow) {
          setSelectedConnectorIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSelectedConnectorIndex((prev) => Math.min(connectorList.length - 1, prev + 1));
        } else if (input === ' ') {
          // Toggle connector
          const item = connectorList[selectedConnectorIndex];
          if (item && item.installed) {
            setEnabledConnectors((prev) => {
              const next = new Set(prev);
              if (next.has(item.name)) {
                next.delete(item.name);
              } else {
                next.add(item.name);
              }
              return next;
            });
          }
        } else if (key.return) {
          goNext();
        }
        break;
      }

      case 'connector-keys':
        // TextInput handles this
        break;

      case 'summary':
        if (key.return) {
          handleComplete();
        }
        break;
    }
  }, { isActive: currentStep !== 'api-key' && currentStep !== 'connector-keys' });

  // Handle Esc and linefeed Enter for text input steps
  useInput((input, key) => {
    if (currentStep === 'api-key') {
      if (key.escape) {
        goBack();
        return;
      }
      if (!key.return && input === '\n') {
        submitApiKey(apiKey);
      }
      return;
    }
    if (currentStep === 'connector-keys') {
      if (key.escape) {
        goBack();
        return;
      }
      if (!key.return && input === '\n') {
        submitConnectorKey(connectorKeyValue);
      }
    }
  }, { isActive: currentStep === 'api-key' || currentStep === 'connector-keys' });

  // Connector display list
  const [selectedConnectorIndex, setSelectedConnectorIndex] = useState(0);

  const getConnectorDisplayList = useCallback(() => {
    const items: Array<{ name: string; desc: string; installed: boolean; install?: string }> = [];

    // Installed connectors first
    for (const name of discoveredConnectors) {
      const info = POPULAR_CONNECTORS[name];
      items.push({
        name,
        desc: info?.desc || `${name} connector`,
        installed: true,
      });
    }

    // Popular uninstalled suggestions
    for (const [name, info] of Object.entries(POPULAR_CONNECTORS)) {
      if (!discoveredConnectors.includes(name)) {
        items.push({
          name,
          desc: info.desc,
          installed: false,
          install: info.install,
        });
      }
    }

    return items;
  }, [discoveredConnectors]);

  // ============================================
  // Render: Welcome
  // ============================================
  if (currentStep === 'welcome') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginTop={1} marginBottom={1}>
          {isCompact ? (
            <Text bold color={logoColor}>{COMPACT_LOGO}</Text>
          ) : (
            <Text color={logoColor}>{ASCII_LOGO}</Text>
          )}
        </Box>
        <Box marginBottom={1}>
          <Text color="cyan">&gt; </Text>
          <Text>{subtitle}</Text>
          {!subtitleDone && <Text color="cyan">_</Text>}
        </Box>
        <Text color="gray">Press Enter to get started...</Text>
        <Text color="gray" dimColor>Press Escape to skip</Text>
      </Box>
    );
  }

  // ============================================
  // Render: Intro
  // ============================================
  if (currentStep === 'intro') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>What can assistants do?</Text>
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          {INTRO_FEATURES.slice(0, introRevealCount).map((feature, i) => (
            <Box key={i}>
              <Text color="cyan">  &gt; </Text>
              <Text>{feature}</Text>
            </Box>
          ))}
          {introRevealCount < INTRO_FEATURES.length && (
            <Text color="gray">  ...</Text>
          )}
        </Box>
        <Text color="gray">Press Enter to continue...</Text>
      </Box>
    );
  }

  // ============================================
  // Render: API Key
  // ============================================
  if (currentStep === 'api-key') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>Let's set up your API key</Text>
        <Box marginTop={1} marginBottom={1} flexDirection="column">
          <Text>assistants uses Claude by Anthropic. You'll need an API key.</Text>
          <Text>Get one at: <Text color="cyan" underline>https://console.anthropic.com/settings/keys</Text></Text>
        </Box>
        {existingApiKey ? (
          <Box flexDirection="column">
            <Text color="green">Existing API key detected: {existingApiKey.slice(0, 10)}...{existingApiKey.slice(-4)}</Text>
            <Box marginTop={1}>
              <Text color="gray">Press Enter to keep it, or type a new key:</Text>
            </Box>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text>Enter your Anthropic API key:</Text>
        </Box>
        <Box>
          <Text color="cyan">&gt; </Text>
            <TextInput
              value={apiKey}
              onChange={(v) => {
                setApiKey(v);
                setApiKeyError(null);
                setApiKeyValidated(false);
              }}
              onSubmit={submitApiKey}
              placeholder="sk-ant-..."
            />
        </Box>
        {apiKeyError && (
          <Box marginTop={1}>
            <Text color="red">{apiKeyError}</Text>
          </Box>
        )}
        {apiKeyValidated && (
          <Box marginTop={1}>
            <Text color="green">Key validated successfully!</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color="gray">Escape to go back</Text>
        </Box>
      </Box>
    );
  }

  // ============================================
  // Render: Model Selection
  // ============================================
  if (currentStep === 'model-select') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>Choose your default model</Text>
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          {MODELS.map((model, i) => (
            <Box key={model.id}>
              <Text color={i === selectedModelIndex ? 'cyan' : 'gray'}>
                {i === selectedModelIndex ? '  > ' : '    '}
              </Text>
              <Text bold={i === selectedModelIndex} color={i === selectedModelIndex ? 'white' : undefined}>
                {model.label}
              </Text>
              <Text color="gray">  {model.desc}</Text>
            </Box>
          ))}
        </Box>
        <Text color="gray">Use arrow keys to select, Enter to confirm</Text>
      </Box>
    );
  }

  // ============================================
  // Render: Connectors
  // ============================================
  if (currentStep === 'connectors') {
    const connectorList = getConnectorDisplayList();
    const installed = connectorList.filter((c) => c.installed);
    const notInstalled = connectorList.filter((c) => !c.installed);

    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>Connect your tools</Text>
        <Box flexDirection="column" marginTop={1}>
          {installed.length > 0 ? (
            <>
              <Text color="gray">Installed connectors found:</Text>
              {installed.map((c, rawIdx) => {
                const idx = rawIdx;
                const enabled = enabledConnectors.has(c.name);
                return (
                  <Box key={c.name}>
                    <Text color={idx === selectedConnectorIndex ? 'cyan' : 'gray'}>
                      {idx === selectedConnectorIndex ? '> ' : '  '}
                    </Text>
                    <Text color={enabled ? 'green' : 'gray'}>
                      [{enabled ? 'x' : ' '}]
                    </Text>
                    <Text> {c.name}</Text>
                    <Text color="gray">  {c.desc}</Text>
                  </Box>
                );
              })}
            </>
          ) : (
            <Text color="gray">No installed connectors found.</Text>
          )}
        </Box>
        {notInstalled.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="gray">Popular connectors (not installed):</Text>
            {notInstalled.map((c) => (
              <Box key={c.name}>
                <Text color="gray">    {c.name.padEnd(14)}{c.install}</Text>
              </Box>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color="gray">Space to toggle, Enter to continue</Text>
        </Box>
      </Box>
    );
  }

  // ============================================
  // Render: Connector Keys
  // ============================================
  if (currentStep === 'connector-keys') {
    const currentConnector = connectorKeysNeeded[connectorKeyIndex];
    if (!currentConnector) {
      // No more keys needed, advance
      goNext();
      return null;
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>Configure connector: {currentConnector}</Text>
        <Box marginTop={1}>
          <Text>Enter API key for {currentConnector}:</Text>
        </Box>
        <Box>
          <Text color="cyan">&gt; </Text>
          <TextInput
            value={connectorKeyValue}
            onChange={setConnectorKeyValue}
            onSubmit={submitConnectorKey}
            placeholder="Enter API key or press Enter to skip"
          />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">{connectorKeyIndex + 1} of {connectorKeysNeeded.length} connectors</Text>
        </Box>
      </Box>
    );
  }

  // ============================================
  // Render: Summary
  // ============================================
  if (currentStep === 'summary') {
    const maskedKey = apiKey.length > 14
      ? apiKey.slice(0, 10) + '...' + apiKey.slice(-4)
      : apiKey.slice(0, 7) + '...';
    const modelLabel = MODELS[selectedModelIndex]?.label || 'unknown';
    const connectorList = Array.from(enabledConnectors).join(', ') || 'none';

    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold color="green">You're all set!</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">{'┌─────────────────────────────────────┐'}</Text>
          <Text color="gray">{'│'} <Text bold>Configuration Summary</Text>{'              │'}</Text>
          <Text color="gray">{'├─────────────────────────────────────┤'}</Text>
          <Text color="gray">{'│'} API Key:    <Text>{maskedKey.padEnd(24)}</Text>{'│'}</Text>
          <Text color="gray">{'│'} Model:      <Text>{modelLabel.padEnd(24)}</Text>{'│'}</Text>
          <Text color="gray">{'│'} Connectors: <Text>{connectorList.length > 24 ? connectorList.slice(0, 21) + '...' : connectorList.padEnd(24)}</Text>{'│'}</Text>
          <Text color="gray">{'│'} Config:     <Text>{'~/.assistants/'.padEnd(24)}</Text>{'│'}</Text>
          <Text color="gray">{'└─────────────────────────────────────┘'}</Text>
        </Box>
        <Box marginTop={1}>
          {isSaving ? (
            <Text color="yellow">Saving configuration...</Text>
          ) : (
            <Text color="gray">Press Enter to start chatting...</Text>
          )}
        </Box>
      </Box>
    );
  }

  return null;
}

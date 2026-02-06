import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Identity, CreateIdentityOptions } from '@hasna/assistants-core';

// Maximum visible items in lists before pagination kicks in
const MAX_VISIBLE_ITEMS = 5;

type ViewMode = 'list' | 'detail' | 'create' | 'create-form' | 'edit-form' | 'delete-confirm';
type FormStep = 'name' | 'displayName' | 'title' | 'company' | 'communicationStyle' | 'responseLength' | 'context';

const COMMUNICATION_STYLES = ['formal', 'casual', 'professional'] as const;
const RESPONSE_LENGTHS = ['concise', 'detailed', 'balanced'] as const;

interface IdentityPanelProps {
  identities: Identity[];
  activeIdentityId?: string;
  templates: Array<{ name: string; description: string }>;
  onSwitch: (identityId: string) => Promise<void>;
  onCreate: (options: CreateIdentityOptions) => Promise<void>;
  onCreateFromTemplate: (templateName: string) => Promise<void>;
  onUpdate: (identityId: string, updates: Partial<CreateIdentityOptions>) => Promise<void>;
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
  onUpdate,
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

  // Form state
  const [formStep, setFormStep] = useState<FormStep>('name');
  const [formName, setFormName] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formStyleIndex, setFormStyleIndex] = useState(2); // 'professional'
  const [formLengthIndex, setFormLengthIndex] = useState(2); // 'balanced'
  const [formContext, setFormContext] = useState('');
  const [editingIdentity, setEditingIdentity] = useState<Identity | null>(null);

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

  // Calculate visible range for templates list (+1 for "Create custom" option)
  const totalCreateOptions = templates.length + 1;
  const templateRange = useMemo(
    () => getVisibleRange(templateIndex, totalCreateOptions),
    [templateIndex, totalCreateOptions]
  );

  const currentIdentity = identities[identityIndex];

  const resetForm = useCallback(() => {
    setFormStep('name');
    setFormName('');
    setFormDisplayName('');
    setFormTitle('');
    setFormCompany('');
    setFormStyleIndex(2);
    setFormLengthIndex(2);
    setFormContext('');
    setEditingIdentity(null);
  }, []);

  const populateFormFromIdentity = useCallback((identity: Identity) => {
    setFormName(identity.name);
    setFormDisplayName(identity.profile.displayName);
    setFormTitle(identity.profile.title || '');
    setFormCompany(identity.profile.company || '');
    setFormStyleIndex(COMMUNICATION_STYLES.indexOf(identity.preferences.communicationStyle));
    setFormLengthIndex(RESPONSE_LENGTHS.indexOf(identity.preferences.responseLength));
    setFormContext(identity.context || '');
    setFormStep('name');
  }, []);

  // Handle create from template
  const handleCreateFromTemplate = useCallback(async () => {
    const template = templates[templateIndex - 1]; // offset by 1 for "Create custom" option
    if (!template) return;

    setIsProcessing(true);
    try {
      await onCreateFromTemplate(template.name);
      setMode('list');
    } finally {
      setIsProcessing(false);
    }
  }, [templateIndex, templates, onCreateFromTemplate]);

  // Handle create from form
  const handleCreateFromForm = useCallback(async () => {
    if (!formName.trim()) return;

    setIsProcessing(true);
    try {
      await onCreate({
        name: formName.trim(),
        profile: {
          displayName: formDisplayName.trim() || formName.trim(),
          title: formTitle.trim() || undefined,
          company: formCompany.trim() || undefined,
        },
        preferences: {
          communicationStyle: COMMUNICATION_STYLES[formStyleIndex],
          responseLength: RESPONSE_LENGTHS[formLengthIndex],
        },
        context: formContext.trim() || undefined,
      });
      resetForm();
      setMode('list');
    } finally {
      setIsProcessing(false);
    }
  }, [formName, formDisplayName, formTitle, formCompany, formStyleIndex, formLengthIndex, formContext, onCreate, resetForm]);

  // Handle edit form submit
  const handleEditSubmit = useCallback(async () => {
    if (!editingIdentity || !formName.trim()) return;

    setIsProcessing(true);
    try {
      await onUpdate(editingIdentity.id, {
        name: formName.trim(),
        profile: {
          displayName: formDisplayName.trim() || formName.trim(),
          title: formTitle.trim() || undefined,
          company: formCompany.trim() || undefined,
        },
        preferences: {
          communicationStyle: COMMUNICATION_STYLES[formStyleIndex],
          responseLength: RESPONSE_LENGTHS[formLengthIndex],
        },
        context: formContext.trim() || undefined,
      });
      resetForm();
      setMode('list');
    } finally {
      setIsProcessing(false);
    }
  }, [editingIdentity, formName, formDisplayName, formTitle, formCompany, formStyleIndex, formLengthIndex, formContext, onUpdate, resetForm]);

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

  // Form step navigation helpers
  const FORM_STEPS: FormStep[] = ['name', 'displayName', 'title', 'company', 'communicationStyle', 'responseLength', 'context'];

  const goToNextStep = useCallback(() => {
    const idx = FORM_STEPS.indexOf(formStep);
    if (idx < FORM_STEPS.length - 1) {
      setFormStep(FORM_STEPS[idx + 1]);
    }
  }, [formStep]);

  const goToPrevStep = useCallback(() => {
    const idx = FORM_STEPS.indexOf(formStep);
    if (idx > 0) {
      setFormStep(FORM_STEPS[idx - 1]);
    }
  }, [formStep]);

  const isTextStep = formStep === 'name' || formStep === 'displayName' || formStep === 'title' || formStep === 'company' || formStep === 'context';
  const isSelectorStep = formStep === 'communicationStyle' || formStep === 'responseLength';
  const isFormMode = mode === 'create-form' || mode === 'edit-form';

  // Keyboard navigation for list/detail/create/delete modes
  useInput((input, key) => {
    if (isProcessing || isFormMode) return;

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
      if (input === 'e') {
        if (currentIdentity) {
          setEditingIdentity(currentIdentity);
          populateFormFromIdentity(currentIdentity);
          setMode('edit-form');
        }
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

    // Create mode (template selection + custom option)
    if (mode === 'create') {
      if (key.upArrow) {
        setTemplateIndex((prev) => (prev === 0 ? totalCreateOptions - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setTemplateIndex((prev) => (prev === totalCreateOptions - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return) {
        if (templateIndex === 0) {
          // "Create custom identity" selected
          resetForm();
          setMode('create-form');
        } else {
          handleCreateFromTemplate();
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
  }, { isActive: !isFormMode });

  // Form mode: text input steps - escape handling
  useInput((_input, key) => {
    if (!isFormMode || !isTextStep) return;

    if (key.escape) {
      if (formStep === 'name') {
        resetForm();
        setMode(mode === 'edit-form' ? 'detail' : 'create');
      } else {
        goToPrevStep();
      }
    }
  }, { isActive: isFormMode && isTextStep });

  // Form mode: selector steps
  useInput((input, key) => {
    if (!isFormMode || !isSelectorStep) return;

    if (formStep === 'communicationStyle') {
      if (key.upArrow) {
        setFormStyleIndex((prev) => (prev === 0 ? COMMUNICATION_STYLES.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setFormStyleIndex((prev) => (prev === COMMUNICATION_STYLES.length - 1 ? 0 : prev + 1));
        return;
      }
    }

    if (formStep === 'responseLength') {
      if (key.upArrow) {
        setFormLengthIndex((prev) => (prev === 0 ? RESPONSE_LENGTHS.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setFormLengthIndex((prev) => (prev === RESPONSE_LENGTHS.length - 1 ? 0 : prev + 1));
        return;
      }
    }

    if (key.return) {
      goToNextStep();
      return;
    }

    if (key.escape) {
      goToPrevStep();
      return;
    }
  }, { isActive: isFormMode && isSelectorStep });

  // Form text submit handlers
  const handleFormNameSubmit = () => {
    if (!formName.trim()) return;
    goToNextStep();
  };

  const handleFormDisplayNameSubmit = () => {
    goToNextStep();
  };

  const handleFormTitleSubmit = () => {
    goToNextStep();
  };

  const handleFormCompanySubmit = () => {
    goToNextStep();
  };

  const handleFormContextSubmit = () => {
    if (mode === 'create-form') {
      handleCreateFromForm();
    } else {
      handleEditSubmit();
    }
  };

  // Render form summary of completed steps
  const renderFormSummary = () => {
    const steps = FORM_STEPS;
    const currentIdx = steps.indexOf(formStep);
    const completedFields: Array<{ label: string; value: string }> = [];

    if (currentIdx > 0) completedFields.push({ label: 'Name', value: formName });
    if (currentIdx > 1 && formDisplayName) completedFields.push({ label: 'Display Name', value: formDisplayName });
    if (currentIdx > 2 && formTitle) completedFields.push({ label: 'Title', value: formTitle });
    if (currentIdx > 3 && formCompany) completedFields.push({ label: 'Company', value: formCompany });
    if (currentIdx > 4) completedFields.push({ label: 'Style', value: COMMUNICATION_STYLES[formStyleIndex] });
    if (currentIdx > 5) completedFields.push({ label: 'Response', value: RESPONSE_LENGTHS[formLengthIndex] });

    if (completedFields.length === 0) return null;

    return (
      <Box marginBottom={1} flexDirection="column">
        {completedFields.map((field) => (
          <Text key={field.label} dimColor>{field.label}: {field.value}</Text>
        ))}
      </Box>
    );
  };

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
          <Text dimColor>Press n to create a new identity.</Text>
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

  // Create mode (template selection + custom)
  if (mode === 'create') {
    const allOptions = [
      { name: 'Create custom identity', description: 'Fill out a form with custom fields' },
      ...templates,
    ];
    const visibleOptions = allOptions.slice(templateRange.start, templateRange.end);

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Create Identity</Text>
          {totalCreateOptions > MAX_VISIBLE_ITEMS && (
            <Text dimColor> ({templateIndex + 1}/{totalCreateOptions})</Text>
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

          {visibleOptions.map((option, visibleIdx) => {
            const actualIdx = templateRange.start + visibleIdx;
            const isSelected = actualIdx === templateIndex;
            const prefix = isSelected ? '> ' : '  ';
            const isCustom = actualIdx === 0;

            return (
              <Box key={option.name} paddingY={0}>
                <Text
                  inverse={isSelected}
                  dimColor={!isSelected}
                  color={isCustom && isSelected ? 'cyan' : undefined}
                >
                  {prefix}{option.name.padEnd(24)} {option.description}
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

  // Create form / Edit form
  if (mode === 'create-form' || mode === 'edit-form') {
    const isEdit = mode === 'edit-form';
    const stepIdx = FORM_STEPS.indexOf(formStep);
    const stepLabel = `Step ${stepIdx + 1}/${FORM_STEPS.length}`;

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{isEdit ? 'Edit Identity' : 'Create Custom Identity'}</Text>
          <Text dimColor> - {stepLabel}</Text>
        </Box>

        {renderFormSummary()}

        {formStep === 'name' && (
          <Box flexDirection="column">
            <Box>
              <Text>Name: </Text>
              <TextInput
                value={formName}
                onChange={setFormName}
                onSubmit={handleFormNameSubmit}
                placeholder="Identity name (required)..."
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter to continue | Esc to {isEdit ? 'cancel' : 'go back'}</Text>
            </Box>
          </Box>
        )}

        {formStep === 'displayName' && (
          <Box flexDirection="column">
            <Box>
              <Text>Display Name: </Text>
              <TextInput
                value={formDisplayName}
                onChange={setFormDisplayName}
                onSubmit={handleFormDisplayNameSubmit}
                placeholder={`Display name (default: ${formName})...`}
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter to continue | Esc back</Text>
            </Box>
          </Box>
        )}

        {formStep === 'title' && (
          <Box flexDirection="column">
            <Box>
              <Text>Title: </Text>
              <TextInput
                value={formTitle}
                onChange={setFormTitle}
                onSubmit={handleFormTitleSubmit}
                placeholder="Job title (optional)..."
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter to continue | Esc back</Text>
            </Box>
          </Box>
        )}

        {formStep === 'company' && (
          <Box flexDirection="column">
            <Box>
              <Text>Company: </Text>
              <TextInput
                value={formCompany}
                onChange={setFormCompany}
                onSubmit={handleFormCompanySubmit}
                placeholder="Company name (optional)..."
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter to continue | Esc back</Text>
            </Box>
          </Box>
        )}

        {formStep === 'communicationStyle' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>Communication Style:</Text>
            </Box>
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
              {COMMUNICATION_STYLES.map((style, index) => (
                <Box key={style} paddingY={0}>
                  <Text
                    inverse={index === formStyleIndex}
                    color={index === formStyleIndex ? 'cyan' : undefined}
                    dimColor={index !== formStyleIndex}
                  >
                    {index === formStyleIndex ? '>' : ' '} {style}
                  </Text>
                </Box>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>↑↓ select | Enter continue | Esc back</Text>
            </Box>
          </Box>
        )}

        {formStep === 'responseLength' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>Response Length:</Text>
            </Box>
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
              {RESPONSE_LENGTHS.map((length, index) => (
                <Box key={length} paddingY={0}>
                  <Text
                    inverse={index === formLengthIndex}
                    color={index === formLengthIndex ? 'cyan' : undefined}
                    dimColor={index !== formLengthIndex}
                  >
                    {index === formLengthIndex ? '>' : ' '} {length}
                  </Text>
                </Box>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text dimColor>↑↓ select | Enter continue | Esc back</Text>
            </Box>
          </Box>
        )}

        {formStep === 'context' && (
          <Box flexDirection="column">
            <Box>
              <Text>Context: </Text>
              <TextInput
                value={formContext}
                onChange={setFormContext}
                onSubmit={handleFormContextSubmit}
                placeholder="Custom personality notes (optional)..."
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Enter to {isEdit ? 'save' : 'create'} | Esc back</Text>
            </Box>
          </Box>
        )}

        {isProcessing && (
          <Box marginTop={1}>
            <Text color="yellow">{isEdit ? 'Saving...' : 'Creating...'}</Text>
          </Box>
        )}
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
                <Text dimColor>{currentIdentity.context.slice(0, 200)}{currentIdentity.context.length > 200 ? '...' : ''}</Text>
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
            e edit |{' '}
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

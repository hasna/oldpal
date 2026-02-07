import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Skill } from '@hasna/assistants-shared';
import type { CreateSkillOptions, CreateSkillResult, SkillScope } from '@hasna/assistants-core';

interface SkillsPanelProps {
  skills: Skill[];
  onExecute: (name: string) => void;
  onCreate: (options: CreateSkillOptions) => Promise<CreateSkillResult>;
  onDelete: (name: string, filePath: string) => Promise<void>;
  onRefresh: () => Promise<Skill[]>;
  onEnsureContent: (name: string) => Promise<Skill | null>;
  onClose: () => void;
  cwd: string;
}

type Mode = 'list' | 'detail' | 'delete-confirm' | 'create';
type CreateStep = 'scope' | 'name' | 'description' | 'tools' | 'hint' | 'content' | 'confirm';

const SCOPE_OPTIONS: { id: SkillScope; label: string; desc: string }[] = [
  { id: 'project', label: 'Project', desc: 'Local to this project (.assistants/skills)' },
  { id: 'global', label: 'Global', desc: 'Available everywhere (~/.assistants/shared/skills)' },
];

function getSkillScope(filePath: string): 'global' | 'project' {
  if (filePath.includes('/shared/skills/') || filePath.includes('\\shared\\skills\\')) {
    return 'global';
  }
  return 'project';
}

export function SkillsPanel({
  skills: initialSkills,
  onExecute,
  onCreate,
  onDelete,
  onRefresh,
  onEnsureContent,
  onClose,
  cwd,
}: SkillsPanelProps) {
  const [skills, setSkills] = useState(initialSkills);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null);

  // Create flow state
  const [createStep, setCreateStep] = useState<CreateStep>('scope');
  const [createScopeIndex, setCreateScopeIndex] = useState(0);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createTools, setCreateTools] = useState('');
  const [createHint, setCreateHint] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  // Group skills by scope
  const projectSkills = skills.filter(s => getSkillScope(s.filePath) === 'project');
  const globalSkills = skills.filter(s => getSkillScope(s.filePath) === 'global');
  const sortedSkills = [...projectSkills, ...globalSkills];
  const totalItems = sortedSkills.length + 1; // +1 for "New skill" action

  useEffect(() => {
    setSkills(initialSkills);
  }, [initialSkills]);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, totalItems - 1)));
  }, [totalItems]);

  const selectedSkill = selectedIndex < sortedSkills.length ? sortedSkills[selectedIndex] : undefined;

  function resetCreateState() {
    setCreateStep('scope');
    setCreateScopeIndex(0);
    setCreateName('');
    setCreateDescription('');
    setCreateTools('');
    setCreateHint('');
    setCreateContent('');
    setCreateError(null);
  }

  async function handleCreateSubmit() {
    const scope = SCOPE_OPTIONS[createScopeIndex].id;
    const name = createName.trim();
    if (!name) {
      setCreateError('Name is required');
      setCreateStep('name');
      return;
    }

    const tools = createTools.trim()
      ? createTools.split(',').map(t => t.trim()).filter(Boolean)
      : undefined;

    setIsSubmitting(true);
    setCreateError(null);
    try {
      await onCreate({
        name,
        scope,
        description: createDescription.trim() || undefined,
        allowedTools: tools,
        argumentHint: createHint.trim() || undefined,
        content: createContent.trim() || undefined,
        cwd,
      });
      const refreshed = await onRefresh();
      setSkills(refreshed);
      resetCreateState();
      setMode('list');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  // Create mode input - non-text steps
  useInput((input, key) => {
    if (mode !== 'create') return;

    // Steps that use TextInput handle their own input
    if (['name', 'description', 'tools', 'hint', 'content'].includes(createStep)) return;

    if (key.escape) {
      if (createStep === 'scope') {
        resetCreateState();
        setMode('list');
      } else {
        const stepOrder: CreateStep[] = ['scope', 'name', 'description', 'tools', 'hint', 'content', 'confirm'];
        const currentIdx = stepOrder.indexOf(createStep);
        if (currentIdx > 0) {
          setCreateStep(stepOrder[currentIdx - 1]);
        } else {
          resetCreateState();
          setMode('list');
        }
      }
      return;
    }

    // Scope selection
    if (createStep === 'scope') {
      if (key.upArrow) {
        setCreateScopeIndex((prev) => (prev === 0 ? SCOPE_OPTIONS.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setCreateScopeIndex((prev) => (prev === SCOPE_OPTIONS.length - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return) {
        setCreateStep('name');
        return;
      }
    }

    // Confirm step
    if (createStep === 'confirm') {
      if (key.return || input === 'y' || input === 'Y') {
        handleCreateSubmit();
        return;
      }
      if (input === 'n' || input === 'N') {
        resetCreateState();
        setMode('list');
        return;
      }
    }
  }, { isActive: mode === 'create' && !['name', 'description', 'tools', 'hint', 'content'].includes(createStep) });

  // List/detail/delete mode input
  useInput((input, key) => {
    if (mode === 'create') return;

    if (mode === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        if (selectedSkill) {
          setIsSubmitting(true);
          onDelete(selectedSkill.name, selectedSkill.filePath).then(() => {
            return onRefresh();
          }).then((refreshed) => {
            setSkills(refreshed);
            setMode('list');
          }).finally(() => {
            setIsSubmitting(false);
          });
        }
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
        return;
      }
      return;
    }

    if (mode === 'detail') {
      if (key.escape || input === 'q' || input === 'Q') {
        setDetailSkill(null);
        setMode('list');
        return;
      }
      if (input === 'x' || input === 'X') {
        if (detailSkill) {
          onExecute(detailSkill.name);
          setDetailSkill(null);
          setMode('list');
          onClose();
        }
        return;
      }
      if (input === 'd' || input === 'D') {
        setMode('delete-confirm');
        return;
      }
      return;
    }

    // List mode
    if (key.escape || input === 'q' || input === 'Q') {
      onClose();
      return;
    }

    if (input === 'n' || input === 'N') {
      resetCreateState();
      setMode('create');
      return;
    }

    if (key.return) {
      if (selectedIndex === sortedSkills.length) {
        // "New skill" option at bottom
        resetCreateState();
        setMode('create');
      } else if (selectedSkill) {
        // Open detail view, loading content if needed
        setIsSubmitting(true);
        onEnsureContent(selectedSkill.name).then((loaded) => {
          if (loaded) {
            setDetailSkill(loaded);
          } else {
            setDetailSkill(selectedSkill);
          }
          setMode('detail');
        }).finally(() => {
          setIsSubmitting(false);
        });
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? totalItems - 1 : prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev === totalItems - 1 ? 0 : prev + 1));
      return;
    }

    if (input === 'x' || input === 'X') {
      if (selectedSkill) {
        onExecute(selectedSkill.name);
        onClose();
      }
      return;
    }

    if (input === 'd' || input === 'D') {
      if (selectedSkill) setMode('delete-confirm');
      return;
    }

    if (input === 'f' || input === 'F') {
      setIsSubmitting(true);
      onRefresh().then((refreshed) => {
        setSkills(refreshed);
      }).finally(() => {
        setIsSubmitting(false);
      });
      return;
    }

    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= sortedSkills.length) {
      setSelectedIndex(num - 1);
      return;
    }
  }, { isActive: mode !== 'create' });

  // ── Create mode UI ──────────────────────────────────────────────

  if (mode === 'create') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">New Skill</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
          {/* Step 1: Scope selection */}
          {createStep === 'scope' && (
            <Box flexDirection="column">
              <Text bold>Select scope:</Text>
              <Box flexDirection="column" marginTop={1}>
                {SCOPE_OPTIONS.map((opt, idx) => (
                  <Box key={opt.id}>
                    <Text inverse={idx === createScopeIndex}>
                      {idx === createScopeIndex ? '>' : ' '} {opt.label.padEnd(10)} <Text dimColor>{opt.desc}</Text>
                    </Text>
                  </Box>
                ))}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>↑↓ select | Enter confirm | Esc cancel</Text>
              </Box>
            </Box>
          )}

          {/* Step 2: Name */}
          {createStep === 'name' && (
            <Box flexDirection="column">
              <Text bold>Enter skill name:</Text>
              <Box marginTop={1}>
                <Text>Name: </Text>
                <TextInput
                  value={createName}
                  onChange={setCreateName}
                  onSubmit={() => {
                    if (createName.trim()) setCreateStep('description');
                  }}
                  placeholder="e.g. my-helper"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter next | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 3: Description */}
          {createStep === 'description' && (
            <Box flexDirection="column">
              <Text bold>Description (optional):</Text>
              <Box marginTop={1}>
                <TextInput
                  value={createDescription}
                  onChange={setCreateDescription}
                  onSubmit={() => setCreateStep('tools')}
                  placeholder="What does this skill do?"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter next | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 4: Allowed tools */}
          {createStep === 'tools' && (
            <Box flexDirection="column">
              <Text bold>Allowed tools (optional, comma-separated):</Text>
              <Box marginTop={1}>
                <TextInput
                  value={createTools}
                  onChange={setCreateTools}
                  onSubmit={() => setCreateStep('hint')}
                  placeholder="e.g. bash, filesystem"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter next | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 5: Argument hint */}
          {createStep === 'hint' && (
            <Box flexDirection="column">
              <Text bold>Argument hint (optional):</Text>
              <Box marginTop={1}>
                <TextInput
                  value={createHint}
                  onChange={setCreateHint}
                  onSubmit={() => setCreateStep('content')}
                  placeholder="e.g. [filename] [options]"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter next | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 6: Content */}
          {createStep === 'content' && (
            <Box flexDirection="column">
              <Text bold>Skill content (optional, single line):</Text>
              <Box marginTop={1}>
                <TextInput
                  value={createContent}
                  onChange={setCreateContent}
                  onSubmit={() => setCreateStep('confirm')}
                  placeholder="Instructions for the skill (or leave empty for default template)"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter next | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 7: Confirm */}
          {createStep === 'confirm' && (
            <Box flexDirection="column">
              <Text bold>Confirm new skill:</Text>
              <Box flexDirection="column" marginTop={1} marginLeft={1}>
                <Text>Scope: <Text color="cyan">{SCOPE_OPTIONS[createScopeIndex].label}</Text></Text>
                <Text>Name: <Text color="cyan">{createName}</Text></Text>
                {createDescription && <Text>Description: <Text dimColor>{createDescription}</Text></Text>}
                {createTools && <Text>Tools: <Text dimColor>{createTools}</Text></Text>}
                {createHint && <Text>Hint: <Text dimColor>{createHint}</Text></Text>}
                {createContent && <Text>Content: <Text dimColor>{createContent.slice(0, 60)}{createContent.length > 60 ? '...' : ''}</Text></Text>}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter/y create | n cancel | Esc back</Text>
              </Box>
            </Box>
          )}

          {createError && (
            <Box marginTop={1}>
              <Text color="red">{createError}</Text>
            </Box>
          )}
        </Box>

        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">Creating skill...</Text>
          </Box>
        )}
      </Box>
    );
  }

  // ── Delete confirmation ─────────────────────────────────────────

  if (mode === 'delete-confirm') {
    const skill = detailSkill || selectedSkill;
    const displayName = skill?.name || '';
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Skill</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            Delete skill &quot;{displayName}&quot;?
          </Text>
        </Box>
        {skill && (
          <Box marginBottom={1}>
            <Text dimColor>File: {skill.filePath}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text>
            Press <Text color="green" bold>y</Text> to confirm or{' '}
            <Text color="red" bold>n</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Detail mode ─────────────────────────────────────────────────

  if (mode === 'detail' && detailSkill) {
    const s = detailSkill;
    const scope = getSkillScope(s.filePath);

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Skill Details</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
          <Box><Text bold>Name: </Text><Text color="cyan">{s.name}</Text></Box>
          <Box><Text bold>Scope: </Text><Text>{scope}</Text></Box>
          {s.description && <Box><Text bold>Description: </Text><Text>{s.description}</Text></Box>}
          {s.argumentHint && <Box><Text bold>Argument Hint: </Text><Text>{s.argumentHint}</Text></Box>}
          {s.allowedTools && s.allowedTools.length > 0 && (
            <Box><Text bold>Allowed Tools: </Text><Text>{s.allowedTools.join(', ')}</Text></Box>
          )}
          {s.model && <Box><Text bold>Model: </Text><Text>{s.model}</Text></Box>}
          <Box><Text bold>File: </Text><Text dimColor>{s.filePath}</Text></Box>

          {s.contentLoaded && s.content && (
            <>
              <Box marginTop={1}><Text bold>Content:</Text></Box>
              <Box marginLeft={2} flexDirection="column">
                {s.content.split('\n').slice(0, 20).map((line, i) => (
                  <Text key={i} wrap="wrap" dimColor>{line}</Text>
                ))}
                {s.content.split('\n').length > 20 && (
                  <Text dimColor>... ({s.content.split('\n').length - 20} more lines)</Text>
                )}
              </Box>
            </>
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            [x]execute | [d]elete | Esc/q back
          </Text>
        </Box>

        {isSubmitting && <Box marginTop={1}><Text color="yellow">Loading...</Text></Box>}
      </Box>
    );
  }

  // ── List mode ───────────────────────────────────────────────────

  let listIndex = 0;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Skills</Text>
        <Text dimColor>[n]ew [x]execute [d]elete [f]refresh</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          {sortedSkills.length} skill(s) — {projectSkills.length} project, {globalSkills.length} global
        </Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {sortedSkills.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No skills loaded. Press n to create one.</Text>
          </Box>
        ) : (
          <>
            {/* Project Skills */}
            {projectSkills.length > 0 && (
              <>
                <Box marginTop={0}>
                  <Text bold dimColor>Project Skills</Text>
                </Box>
                {projectSkills.map((skill) => {
                  const idx = listIndex++;
                  const isSelected = idx === selectedIndex;
                  const desc = skill.description ? ` - ${skill.description}` : '';
                  return (
                    <Box key={skill.name} paddingY={0}>
                      <Text inverse={isSelected}>
                        {isSelected ? '>' : ' '} {(idx + 1).toString().padStart(2)}. {skill.name.padEnd(20)}{desc.slice(0, 40)}
                      </Text>
                    </Box>
                  );
                })}
              </>
            )}

            {/* Global Skills */}
            {globalSkills.length > 0 && (
              <>
                <Box marginTop={projectSkills.length > 0 ? 1 : 0}>
                  <Text bold dimColor>Global Skills</Text>
                </Box>
                {globalSkills.map((skill) => {
                  const idx = listIndex++;
                  const isSelected = idx === selectedIndex;
                  const desc = skill.description ? ` - ${skill.description}` : '';
                  return (
                    <Box key={skill.name} paddingY={0}>
                      <Text inverse={isSelected}>
                        {isSelected ? '>' : ' '} {(idx + 1).toString().padStart(2)}. {skill.name.padEnd(20)}{desc.slice(0, 40)}
                      </Text>
                    </Box>
                  );
                })}
              </>
            )}
          </>
        )}

        {/* New skill option at bottom */}
        <Box marginTop={1} paddingY={0}>
          <Text
            inverse={selectedIndex === sortedSkills.length}
            dimColor={selectedIndex !== sortedSkills.length}
            color={selectedIndex === sortedSkills.length ? 'cyan' : undefined}
          >
            + New skill (n)
          </Text>
        </Box>
      </Box>

      {/* Compact preview of selected */}
      {selectedSkill && selectedIndex < sortedSkills.length && (
        <Box marginTop={1}>
          <Text dimColor>
            {getSkillScope(selectedSkill.filePath)} | {selectedSkill.argumentHint || 'no args'} | Enter for details
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Enter view | ↑↓ navigate | [n]ew | [d]elete | [x]execute | q quit</Text>
      </Box>

      {isSubmitting && <Box marginTop={1}><Text color="yellow">Processing...</Text></Box>}
    </Box>
  );
}

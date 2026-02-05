import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { GuardrailsConfig, GuardrailsPolicy, PolicyAction, ToolPolicyRule } from '@hasna/assistants-core';

interface PolicyInfo {
  id: string;
  name: string;
  scope: string;
  enabled: boolean;
  location: 'user' | 'project' | 'local' | 'system';
  policy: GuardrailsPolicy;
}

interface GuardrailsPanelProps {
  config: GuardrailsConfig;
  policies: PolicyInfo[];
  onToggleEnabled: (enabled: boolean) => void;
  onTogglePolicy: (policyId: string, enabled: boolean) => void;
  onSetPreset: (preset: 'permissive' | 'restrictive') => void;
  onCancel: () => void;
}

type Mode = 'overview' | 'policies' | 'tools' | 'delete-confirm' | 'preset-select';

const SCOPE_COLORS: Record<string, string> = {
  system: 'red',
  organization: 'magenta',
  project: 'yellow',
  session: 'green',
};

const ACTION_COLORS: Record<PolicyAction, string> = {
  allow: 'green',
  deny: 'red',
  require_approval: 'yellow',
  warn: 'cyan',
};

export function GuardrailsPanel({
  config,
  policies,
  onToggleEnabled,
  onTogglePolicy,
  onSetPreset,
  onCancel,
}: GuardrailsPanelProps) {
  const [mode, setMode] = useState<Mode>('overview');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Flatten tool rules for tool view
  const toolRules = useMemo(() => {
    const rules: Array<{ policyId: string; policyName: string; rule: ToolPolicyRule }> = [];
    for (const policyInfo of policies) {
      if (!policyInfo.policy.tools?.rules) continue;
      for (const rule of policyInfo.policy.tools.rules) {
        rules.push({
          policyId: policyInfo.id,
          policyName: policyInfo.name,
          rule,
        });
      }
    }
    return rules;
  }, [policies]);

  // Current list based on mode
  const currentList = mode === 'policies' ? policies : mode === 'tools' ? toolRules : [];
  const totalItems = currentList.length;

  useInput((input, key) => {
    // Preset selection mode
    if (mode === 'preset-select') {
      if (input === '1') {
        onSetPreset('permissive');
        setMode('overview');
        return;
      }
      if (input === '2') {
        onSetPreset('restrictive');
        setMode('overview');
        return;
      }
      if (key.escape || input === 'q' || input === 'Q') {
        setMode('overview');
        return;
      }
      return;
    }

    // Navigation in policies or tools mode
    if (mode === 'policies' || mode === 'tools') {
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev === 0 ? Math.max(0, totalItems - 1) : prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev >= totalItems - 1 ? 0 : prev + 1));
        return;
      }

      // Toggle policy enabled (only in policies mode)
      if (mode === 'policies' && (input === 'e' || input === 'E')) {
        const policy = policies[selectedIndex];
        if (policy && policy.location !== 'system') {
          onTogglePolicy(policy.id, true);
        }
        return;
      }
      if (mode === 'policies' && (input === 'd' || input === 'D')) {
        const policy = policies[selectedIndex];
        if (policy && policy.location !== 'system') {
          onTogglePolicy(policy.id, false);
        }
        return;
      }

      // Back to overview
      if (key.escape || input === 'b' || input === 'B') {
        setMode('overview');
        setSelectedIndex(0);
        return;
      }
    }

    // Overview mode shortcuts
    if (mode === 'overview') {
      // Toggle guardrails enabled/disabled
      if (input === 'e' || input === 'E') {
        onToggleEnabled(true);
        return;
      }
      if (input === 'd' || input === 'D') {
        onToggleEnabled(false);
        return;
      }

      // View modes
      if (input === 'p' || input === 'P') {
        setMode('policies');
        setSelectedIndex(0);
        return;
      }
      if (input === 't' || input === 'T') {
        setMode('tools');
        setSelectedIndex(0);
        return;
      }
      if (input === 's' || input === 'S') {
        setMode('preset-select');
        return;
      }
    }

    // Quit
    if (key.escape || input === 'q' || input === 'Q') {
      onCancel();
      return;
    }
  }, { isActive: true });

  // Preset selection mode
  if (mode === 'preset-select') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Select Preset Policy</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
          <Box marginBottom={1}>
            <Text bold color="green">1.</Text>
            <Text> Permissive - Allow most operations, warn on dangerous commands</Text>
          </Box>
          <Box>
            <Text bold color="red">2.</Text>
            <Text> Restrictive - Deny by default, require approval for most tools</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[1] permissive [2] restrictive [q] cancel</Text>
        </Box>
      </Box>
    );
  }

  // Policies list mode
  if (mode === 'policies') {
    const selectedPolicy = policies[selectedIndex];

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold>Policies</Text>
          <Text dimColor>{policies.length} polic{policies.length !== 1 ? 'ies' : 'y'}</Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          height={Math.min(12, policies.length + 2)}
          overflowY="hidden"
        >
          {policies.length === 0 ? (
            <Box paddingY={1}>
              <Text dimColor>No policies configured.</Text>
            </Box>
          ) : (
            policies.map((policy, index) => {
              const isSelected = index === selectedIndex;
              const scopeColor = SCOPE_COLORS[policy.scope] || 'white';

              return (
                <Box key={policy.id}>
                  <Text inverse={isSelected}>
                    {isSelected ? '>' : ' '}{' '}
                    <Text color={policy.enabled ? 'green' : 'red'}>[{policy.enabled ? 'on ' : 'off'}]</Text>{' '}
                    <Text bold={isSelected}>{(policy.name || policy.id).slice(0, 20).padEnd(20)}</Text>{' '}
                    <Text color={scopeColor}>{policy.scope.padEnd(10)}</Text>{' '}
                    <Text dimColor>{policy.location}</Text>
                  </Text>
                </Box>
              );
            })
          )}
        </Box>

        {/* Selected policy details */}
        {selectedPolicy && (
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text dimColor>Scope: </Text>
              <Text color={SCOPE_COLORS[selectedPolicy.scope]}>{selectedPolicy.scope}</Text>
            </Box>
            <Box>
              <Text dimColor>Location: </Text>
              <Text>{selectedPolicy.location}</Text>
            </Box>
            {selectedPolicy.policy.tools && (
              <Box>
                <Text dimColor>Tool Rules: </Text>
                <Text>{selectedPolicy.policy.tools.rules.length}</Text>
                <Text dimColor> (default: </Text>
                <Text color={ACTION_COLORS[selectedPolicy.policy.tools.defaultAction]}>
                  {selectedPolicy.policy.tools.defaultAction}
                </Text>
                <Text dimColor>)</Text>
              </Box>
            )}
            {selectedPolicy.policy.depth && (
              <Box>
                <Text dimColor>Max Depth: </Text>
                <Text>{selectedPolicy.policy.depth.maxDepth}</Text>
              </Box>
            )}
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            {selectedPolicy?.location !== 'system' ? '[e]nable [d]isable ' : ''}[b]ack [q]uit | ↑↓ navigate
          </Text>
        </Box>
      </Box>
    );
  }

  // Tools rules mode
  if (mode === 'tools') {
    const selectedRule = toolRules[selectedIndex];

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold>Tool Rules</Text>
          <Text dimColor>{toolRules.length} rule{toolRules.length !== 1 ? 's' : ''}</Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          height={Math.min(12, toolRules.length + 2)}
          overflowY="hidden"
        >
          {toolRules.length === 0 ? (
            <Box paddingY={1}>
              <Text dimColor>No tool rules configured.</Text>
            </Box>
          ) : (
            toolRules.map((item, index) => {
              const isSelected = index === selectedIndex;
              const actionColor = ACTION_COLORS[item.rule.action];

              return (
                <Box key={`${item.policyId}-${item.rule.pattern}`}>
                  <Text inverse={isSelected}>
                    {isSelected ? '>' : ' '}{' '}
                    <Text color={actionColor}>[{item.rule.action.slice(0, 4).padEnd(4)}]</Text>{' '}
                    <Text bold={isSelected}>{item.rule.pattern.slice(0, 25).padEnd(25)}</Text>{' '}
                    <Text dimColor>{item.policyName.slice(0, 15)}</Text>
                  </Text>
                </Box>
              );
            })
          )}
        </Box>

        {/* Selected rule details */}
        {selectedRule && (
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text dimColor>Pattern: </Text>
              <Text>{selectedRule.rule.pattern}</Text>
            </Box>
            <Box>
              <Text dimColor>Action: </Text>
              <Text color={ACTION_COLORS[selectedRule.rule.action]}>{selectedRule.rule.action}</Text>
            </Box>
            {selectedRule.rule.reason && (
              <Box>
                <Text dimColor>Reason: </Text>
                <Text>{selectedRule.rule.reason}</Text>
              </Box>
            )}
            {selectedRule.rule.conditions && selectedRule.rule.conditions.length > 0 && (
              <Box>
                <Text dimColor>Conditions: </Text>
                <Text>{selectedRule.rule.conditions.length}</Text>
              </Box>
            )}
            <Box>
              <Text dimColor>Policy: </Text>
              <Text>{selectedRule.policyName}</Text>
            </Box>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>[b]ack [q]uit | ↑↓ navigate</Text>
        </Box>
      </Box>
    );
  }

  // Overview mode (default)
  const enabledPolicies = policies.filter((p) => p.enabled).length;
  const totalRules = toolRules.length;
  const denyRules = toolRules.filter((r) => r.rule.action === 'deny').length;
  const approvalRules = toolRules.filter((r) => r.rule.action === 'require_approval').length;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Guardrails</Text>
        <Text color={config.enabled ? 'green' : 'red'}>
          {config.enabled ? 'Enabled' : 'Disabled'}
        </Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
        {/* Status */}
        <Box marginBottom={1}>
          <Text bold>Status: </Text>
          <Text color={config.enabled ? 'green' : 'red'}>
            {config.enabled ? 'Enforcing policies' : 'Not enforcing (all tools allowed)'}
          </Text>
        </Box>

        {/* Stats */}
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text dimColor>Policies: </Text>
            <Text>{enabledPolicies}/{policies.length} enabled</Text>
          </Box>
          <Box>
            <Text dimColor>Tool Rules: </Text>
            <Text>{totalRules} total</Text>
            {denyRules > 0 && (
              <Text>
                {' '}(<Text color="red">{denyRules} deny</Text>
                {approvalRules > 0 && <Text>, </Text>}
                {approvalRules > 0 && <Text color="yellow">{approvalRules} approval</Text>})
              </Text>
            )}
          </Box>
          <Box>
            <Text dimColor>Default Action: </Text>
            <Text color={ACTION_COLORS[config.defaultAction]}>{config.defaultAction}</Text>
          </Box>
        </Box>

        {/* Quick policy summary */}
        {policies.filter((p) => p.enabled).length > 0 && (
          <Box flexDirection="column">
            <Text bold dimColor>Active Policies:</Text>
            {policies
              .filter((p) => p.enabled)
              .slice(0, 3)
              .map((p) => (
                <Box key={p.id} paddingLeft={1}>
                  <Text>• {p.name || p.id}</Text>
                  <Text dimColor> ({p.scope})</Text>
                </Box>
              ))}
            {policies.filter((p) => p.enabled).length > 3 && (
              <Box paddingLeft={1}>
                <Text dimColor>+ {policies.filter((p) => p.enabled).length - 3} more</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [e]nable [d]isable [p]olicies [t]ool rules [s]et preset [q]uit
        </Text>
      </Box>
    </Box>
  );
}

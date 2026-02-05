# Guardrails System Documentation

The guardrails system provides security and safety policies for controlling agent behavior, protecting sensitive data, and enforcing approval workflows.

## Overview

Guardrails enable you to:
- **Control tool access** - Allow, deny, or require approval for specific tools
- **Protect sensitive data** - Define data sensitivity rules and redaction
- **Enforce approval workflows** - Require human approval for certain actions
- **Limit agent depth** - Prevent runaway subagent spawning
- **Apply rate limits** - Control execution speed

## Configuration

### Enabling Guardrails

Guardrails are disabled by default. Enable them via:

**Terminal Command:**
```bash
/guardrails enable
```

**Config File (`~/.assistants/guardrails.json`):**
```json
{
  "enabled": true,
  "policies": [
    {
      "name": "My Policy",
      "scope": "project",
      "enabled": true,
      "tools": {
        "defaultAction": "allow",
        "rules": [
          {
            "pattern": "bash",
            "action": "warn"
          }
        ]
      }
    }
  ],
  "defaultAction": "allow"
}
```

## Policy Scopes

Policies have different scopes that determine precedence (lower = higher priority):

| Scope | Precedence | Description |
|-------|------------|-------------|
| `system` | 0 (highest) | Built-in system policies, cannot be overridden |
| `organization` | 1 | Organization-wide policies |
| `project` | 2 | Project-specific policies |
| `session` | 3 (lowest) | Session-specific policies |

## Policy Actions

| Action | Behavior |
|--------|----------|
| `allow` | Permit the action immediately |
| `deny` | Block the action completely |
| `require_approval` | Pause and wait for user approval |
| `warn` | Log a warning but allow the action |

## Tool Policies

Control which tools can be used and under what conditions.

### Basic Tool Rules

```json
{
  "tools": {
    "defaultAction": "allow",
    "rules": [
      {
        "pattern": "file:read",
        "action": "allow",
        "reason": "Read operations are safe"
      },
      {
        "pattern": "bash",
        "action": "warn",
        "reason": "Shell commands should be reviewed"
      },
      {
        "pattern": "connector:*",
        "action": "require_approval",
        "reason": "External services require approval"
      }
    ]
  }
}
```

### Pattern Matching

Tool patterns support glob-style matching:
- `bash` - Exact match
- `file:*` - Any file operation
- `connector:*` - Any connector
- `*` - Matches everything

### Conditional Rules

Rules can have conditions that must be met:

```json
{
  "pattern": "file:write",
  "action": "deny",
  "conditions": [
    { "type": "input_matches", "value": ".*\\.(env|secret|key)$" }
  ],
  "reason": "Writing to sensitive files is blocked"
}
```

**Condition Types:**
| Type | Description |
|------|-------------|
| `input_contains` | Input contains the specified string |
| `input_matches` | Input matches the regex pattern |
| `context_has` | Context contains the specified key |
| `depth_exceeds` | Agent depth exceeds the value |
| `time_exceeds` | Execution time exceeds the value (ms) |

## Data Sensitivity

Define sensitivity levels for different data patterns:

```json
{
  "dataSensitivity": {
    "defaultLevel": "internal",
    "rules": [
      {
        "pattern": "\\.(env|secret|key)$",
        "level": "restricted",
        "action": "deny",
        "redact": true
      },
      {
        "pattern": "\\.(md|txt)$",
        "level": "public",
        "action": "allow"
      }
    ]
  }
}
```

**Sensitivity Levels:**
| Level | Description |
|-------|-------------|
| `public` | No restrictions |
| `internal` | Internal use only |
| `confidential` | Confidential data |
| `restricted` | Highly restricted, requires special handling |

## Approval Workflows

Require human approval for specific actions:

```json
{
  "approvals": [
    {
      "trigger": "file_write",
      "patterns": [".*\\.(sh|bash)$"],
      "timeout": 300000
    },
    {
      "trigger": "external_call",
      "patterns": ["*"],
      "timeout": 60000
    }
  ]
}
```

**Trigger Types:**
| Trigger | Description |
|---------|-------------|
| `tool_use` | Any tool execution |
| `data_access` | Accessing sensitive data |
| `external_call` | Making external API calls |
| `code_execution` | Running code (eval, exec) |
| `file_write` | Writing to filesystem |

## Depth Policy

Limit how deep subagent chains can go:

```json
{
  "depth": {
    "maxDepth": 5,
    "onExceeded": "deny"
  }
}
```

## Rate Limits

Control execution speed:

```json
{
  "rateLimits": {
    "toolCallsPerMinute": 60,
    "llmCallsPerMinute": 30,
    "externalRequestsPerMinute": 20,
    "onExceeded": "warn"
  }
}
```

## Built-in Policies

### Default System Policy

The default system policy provides baseline protection:
- Allows read operations
- Warns on bash commands
- Denies dangerous patterns (rm -rf /, fork bombs)
- Requires approval for external service calls
- Blocks access to credential files
- Limits subagent depth to 5

### Permissive Preset

For trusted environments with minimal restrictions:
```bash
/guardrails preset permissive
```

- Allows most operations
- Only blocks truly dangerous patterns
- Higher depth limit (10)
- No rate limiting

### Restrictive Preset

For untrusted environments with maximum safety:
```bash
/guardrails preset restrictive
```

- Requires approval for most operations
- Only allows read operations without approval
- Denies all bash commands
- Lower depth limit (2)
- Strict rate limits

## Terminal Commands

### View Guardrails Status
```bash
/guardrails
```
Opens the interactive guardrails panel.

### Enable/Disable
```bash
/guardrails enable
/guardrails disable
```

### Apply Presets
```bash
/guardrails preset permissive
/guardrails preset restrictive
```

### View Current Status
```bash
/guardrails status
```

## Interactive Panel

The guardrails panel (`/guardrails`) provides:

### Overview Mode
- Current enabled/disabled status
- Default action
- Quick enable/disable

### Policies View
- List all policies by scope
- Enable/disable individual policies
- View rule counts

### Tools View
- See all tool rules across policies
- View which policies affect each tool

### Preset Selection
- Choose permissive or restrictive preset
- Instantly apply preset configuration

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `e` | Enable guardrails |
| `d` | Disable guardrails |
| `p` | View policies |
| `t` | View tool rules |
| `s` | Select preset |
| `q` | Close panel |

## Storage Locations

Guardrails can be configured at multiple levels:

| Location | Path | Scope |
|----------|------|-------|
| User | `~/.assistants/guardrails.json` | All projects |
| Project | `.assistants/guardrails.json` | This project |
| Local | `.assistants/guardrails.local.json` | This machine |

Settings merge with higher-precedence locations overriding lower ones.

## Programmatic Access

### GuardrailsStore API

```typescript
import { GuardrailsStore, PolicyEvaluator } from '@hasna/assistants-core';

// Load guardrails
const store = new GuardrailsStore(cwd);
const config = store.loadAll();

// Evaluate a tool call
const evaluator = new PolicyEvaluator(config);
const result = evaluator.evaluateTool('bash', { command: 'ls -la' });

if (!result.allowed) {
  console.log('Blocked:', result.reasons);
}

if (result.requiresApproval) {
  // Wait for user approval
}
```

### Policy Evaluation Result

```typescript
interface PolicyEvaluationResult {
  allowed: boolean;
  action: PolicyAction;
  matchedRules: Array<{ policyId, policyScope, rule }>;
  reasons: string[];
  requiresApproval: boolean;
  approvalDetails?: { approvers, timeout };
  warnings: string[];
}
```

## Best Practices

1. **Start permissive, tighten gradually** - Begin with warnings to understand usage patterns
2. **Use project-level policies** - Share consistent policies with your team
3. **Protect credentials** - Always block access to `.env`, `.secret`, and key files
4. **Limit subagent depth** - Prevent runaway agent chains
5. **Review warnings regularly** - Warnings indicate potential issues
6. **Use approval for external calls** - Review requests to external services

## Integration with Budgets

Guardrails and budgets work together:
- Guardrails control *what* can be done
- Budgets control *how much* can be done

Both provide complementary protection for safe agent execution.

## Example Configurations

### Development Environment
```json
{
  "enabled": true,
  "policies": [
    {
      "scope": "project",
      "enabled": true,
      "tools": {
        "defaultAction": "allow",
        "rules": [
          { "pattern": "bash", "action": "warn" }
        ]
      },
      "depth": { "maxDepth": 5, "onExceeded": "warn" }
    }
  ],
  "defaultAction": "allow"
}
```

### Production Environment
```json
{
  "enabled": true,
  "policies": [
    {
      "scope": "project",
      "enabled": true,
      "tools": {
        "defaultAction": "require_approval",
        "rules": [
          { "pattern": "file:read", "action": "allow" },
          { "pattern": "file:list", "action": "allow" },
          { "pattern": "bash", "action": "deny" }
        ]
      },
      "dataSensitivity": {
        "defaultLevel": "confidential",
        "rules": [
          { "pattern": "\\.(env|secret)$", "level": "restricted", "action": "deny", "redact": true }
        ]
      },
      "depth": { "maxDepth": 2, "onExceeded": "deny" },
      "rateLimits": {
        "toolCallsPerMinute": 30,
        "onExceeded": "deny"
      }
    }
  ],
  "defaultAction": "deny"
}
```

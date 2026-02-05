# Budget System Documentation

The budget system provides resource usage tracking and enforcement to prevent runaway costs and ensure controlled agent behavior.

## Overview

The budget system tracks:
- **Token usage** - Input and output tokens consumed
- **LLM calls** - Number of API calls to the language model
- **Tool calls** - Number of tool executions
- **Duration** - Total time spent processing

## Configuration

### Enabling Budgets

Budgets are disabled by default. Enable them via:

**Terminal Command:**
```bash
/budget enable
```

**Config File (`~/.assistants/config.json`):**
```json
{
  "budget": {
    "enabled": true,
    "session": {
      "maxTotalTokens": 200000,
      "maxLlmCalls": 50,
      "maxToolCalls": 200,
      "maxDurationMs": 1800000
    },
    "onExceeded": "warn"
  }
}
```

### Budget Scopes

| Scope | Description | Default Limits |
|-------|-------------|----------------|
| `session` | Applies to the current session | 1M tokens, 500 LLM calls, 1000 tool calls, 4 hours |
| `agent` | Applies to individual subagents | 500K tokens, 100 LLM calls, 200 tool calls, 30 minutes |
| `swarm` | Applies to coordinated agent swarms | 2M tokens, 1000 LLM calls, 2000 tool calls, 1 hour |

### Default Limits

**Session Limits:**
| Limit | Default Value |
|-------|---------------|
| `maxTotalTokens` | 1,000,000 |
| `maxInputTokens` | (no limit) |
| `maxOutputTokens` | (no limit) |
| `maxLlmCalls` | 500 |
| `maxToolCalls` | 1000 |
| `maxDurationMs` | 14,400,000 (4 hours) |

**Agent Limits:**
| Limit | Default Value |
|-------|---------------|
| `maxTotalTokens` | 500,000 |
| `maxLlmCalls` | 100 |
| `maxToolCalls` | 200 |
| `maxDurationMs` | 1,800,000 (30 minutes) |

**Swarm Limits:**
| Limit | Default Value |
|-------|---------------|
| `maxTotalTokens` | 2,000,000 |
| `maxLlmCalls` | 1000 |
| `maxToolCalls` | 2000 |
| `maxDurationMs` | 3,600,000 (1 hour) |

## Enforcement Actions

When a budget limit is exceeded, the system can take different actions:

| Action | Behavior |
|--------|----------|
| `warn` | Log a warning but continue execution (default) |
| `pause` | Pause execution and wait for user confirmation |
| `stop` | Stop execution immediately |

## Terminal Commands

### View Budget Status
```bash
/budget
```
Opens the interactive budget panel showing current usage and limits.

### Enable/Disable
```bash
/budget enable
/budget disable
```

### Reset Usage
```bash
/budget reset
/budget reset session
/budget reset swarm
```

### Set Limits
```bash
/budget set tokens 100000
/budget set llm-calls 50
/budget set tool-calls 200
/budget set duration 30m
```

### View Current Status
```bash
/budget status
```

## Interactive Panel

The budget panel (`/budget`) provides an interactive UI with:

### Overview Mode
- Current usage with progress bars
- Color-coded status (green = OK, yellow = warning, red = exceeded)
- Warnings when approaching limits (80% threshold)

### Limits View
- View all configured limits
- See the current enforcement action

### Preset Selection
Choose from preconfigured budget presets:

| Preset | Tokens | LLM Calls | Tool Calls | Duration |
|--------|--------|-----------|------------|----------|
| Light | 50K | 20 | 50 | 10 min |
| Moderate | 200K | 50 | 200 | 30 min |
| Heavy | 500K | 100 | 500 | 1 hour |
| Unlimited | - | - | - | - |

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `e` | Enable budgets |
| `d` | Disable budgets |
| `r` | Reset usage |
| `l` | View limits |
| `p` | Select preset |
| `q` | Close panel |

## Persistence

Budget usage can be persisted across sessions:

```json
{
  "budget": {
    "persist": true
  }
}
```

When enabled, usage data is stored in `~/.assistants/budget/{sessionId}.json`.

## Warning Threshold

The system warns when usage reaches 80% of any limit. This gives advance notice before limits are exceeded.

## Programmatic Access

### BudgetTracker API

```typescript
import { BudgetTracker } from '@hasna/assistants-core';

const tracker = new BudgetTracker(sessionId, {
  enabled: true,
  session: { maxTotalTokens: 100000 }
});

// Check budget status
const status = tracker.checkBudget('session');
console.log(status.overallExceeded); // boolean
console.log(status.warningsCount); // number

// Record usage
tracker.recordLlmCall(inputTokens, outputTokens, durationMs);
tracker.recordToolCall(durationMs);

// Get summary
const summary = tracker.getSummary();
```

## Best Practices

1. **Start with warnings** - Use `onExceeded: 'warn'` initially to understand typical usage patterns
2. **Set appropriate limits** - Adjust limits based on task complexity
3. **Use agent limits** - Prevent individual subagents from consuming all resources
4. **Monitor usage** - Check `/budget` periodically during long sessions
5. **Reset when appropriate** - Reset usage counters when starting new tasks

## Integration with Guardrails

Budgets work alongside guardrails:
- Budgets control resource consumption
- Guardrails control security and safety policies

Both can be enabled independently and provide complementary protection.

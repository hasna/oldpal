/**
 * Budget tools for assistant use
 * Native tools that allow assistants to check and manage resource budgets
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { BudgetTracker } from './tracker';
import type { BudgetScope } from './types';

/**
 * budget_status - Get current budget status
 */
export const budgetStatusTool: Tool = {
  name: 'budget_status',
  description: 'Get current budget status showing usage vs limits for the specified scope (session, swarm, or project).',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Budget scope to check: "session" (default), "swarm", or "project"',
        enum: ['session', 'swarm', 'project'],
      },
    },
    required: [],
  },
};

/**
 * budget_get - Get budget configuration
 */
export const budgetGetTool: Tool = {
  name: 'budget_get',
  description: 'Get current budget configuration including limits, thresholds, and actions for all scopes.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * budget_set - Update budget limits
 */
export const budgetSetTool: Tool = {
  name: 'budget_set',
  description: 'Update budget limits for a specific scope. Set individual limits like maxTotalTokens, maxLlmCalls, etc.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Budget scope to update: "session", "swarm", or "project"',
        enum: ['session', 'swarm', 'project'],
      },
      maxInputTokens: {
        type: 'number',
        description: 'Maximum input tokens allowed (0 = unlimited)',
      },
      maxOutputTokens: {
        type: 'number',
        description: 'Maximum output tokens allowed (0 = unlimited)',
      },
      maxTotalTokens: {
        type: 'number',
        description: 'Maximum total tokens allowed (0 = unlimited)',
      },
      maxLlmCalls: {
        type: 'number',
        description: 'Maximum LLM API calls allowed (0 = unlimited)',
      },
      maxToolCalls: {
        type: 'number',
        description: 'Maximum tool calls allowed (0 = unlimited)',
      },
      maxDurationMs: {
        type: 'number',
        description: 'Maximum duration in milliseconds (0 = unlimited)',
      },
    },
    required: ['scope'],
  },
};

/**
 * budget_reset - Reset budget counters
 */
export const budgetResetTool: Tool = {
  name: 'budget_reset',
  description: 'Reset budget usage counters for a specific scope back to zero.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Budget scope to reset: "session", "swarm", or "all"',
        enum: ['session', 'swarm', 'all'],
      },
    },
    required: ['scope'],
  },
};

/**
 * Create executors for budget tools
 */
export function createBudgetToolExecutors(
  getBudgetTracker: () => BudgetTracker | null
): Record<string, ToolExecutor> {
  return {
    budget_status: async (input) => {
      const tracker = getBudgetTracker();
      if (!tracker) {
        return 'Budget tracking is not enabled.';
      }

      const scope = (String(input.scope || 'session') as BudgetScope);
      const status = tracker.checkBudget(scope);

      const lines: string[] = [];
      lines.push(`## Budget Status (${scope})`);
      lines.push('');

      // Usage summary
      const u = status.usage;
      lines.push(`**Usage:**`);
      lines.push(`  Input tokens: ${u.inputTokens.toLocaleString()}`);
      lines.push(`  Output tokens: ${u.outputTokens.toLocaleString()}`);
      lines.push(`  Total tokens: ${u.totalTokens.toLocaleString()}`);
      lines.push(`  LLM calls: ${u.llmCalls}`);
      lines.push(`  Tool calls: ${u.toolCalls}`);
      lines.push(`  Duration: ${Math.round(u.durationMs / 1000)}s`);
      lines.push('');

      // Limits
      const l = status.limits;
      lines.push(`**Limits:**`);
      if (l.maxInputTokens) lines.push(`  Input tokens: ${l.maxInputTokens.toLocaleString()}`);
      if (l.maxOutputTokens) lines.push(`  Output tokens: ${l.maxOutputTokens.toLocaleString()}`);
      if (l.maxTotalTokens) lines.push(`  Total tokens: ${l.maxTotalTokens.toLocaleString()}`);
      if (l.maxLlmCalls) lines.push(`  LLM calls: ${l.maxLlmCalls}`);
      if (l.maxToolCalls) lines.push(`  Tool calls: ${l.maxToolCalls}`);
      if (l.maxDurationMs) lines.push(`  Duration: ${Math.round(l.maxDurationMs / 1000)}s`);
      if (!l.maxInputTokens && !l.maxOutputTokens && !l.maxTotalTokens && !l.maxLlmCalls && !l.maxToolCalls && !l.maxDurationMs) {
        lines.push('  (no limits set)');
      }
      lines.push('');

      // Warnings
      if (status.overallExceeded) {
        lines.push('**STATUS: BUDGET EXCEEDED**');
      } else if (status.warningsCount > 0) {
        lines.push(`**STATUS: ${status.warningsCount} warning(s) - approaching limits**`);
      } else {
        lines.push('**STATUS: OK**');
      }

      return lines.join('\n');
    },

    budget_get: async () => {
      const tracker = getBudgetTracker();
      if (!tracker) {
        return 'Budget tracking is not enabled.';
      }

      const config = tracker.getConfig();
      return JSON.stringify(config, null, 2);
    },

    budget_set: async (input) => {
      const tracker = getBudgetTracker();
      if (!tracker) {
        return 'Budget tracking is not enabled.';
      }

      const scope = String(input.scope || 'session');
      const config = tracker.getConfig();

      // Determine which limits object to update
      let limitsKey: string;
      switch (scope) {
        case 'session':
          limitsKey = 'sessionLimits';
          break;
        case 'swarm':
          limitsKey = 'swarmLimits';
          break;
        case 'project':
          limitsKey = 'projectLimits';
          break;
        default:
          return `Invalid scope: ${scope}. Use "session", "swarm", or "project".`;
      }

      const updates: Record<string, number> = {};
      if (input.maxInputTokens !== undefined) updates.maxInputTokens = Number(input.maxInputTokens);
      if (input.maxOutputTokens !== undefined) updates.maxOutputTokens = Number(input.maxOutputTokens);
      if (input.maxTotalTokens !== undefined) updates.maxTotalTokens = Number(input.maxTotalTokens);
      if (input.maxLlmCalls !== undefined) updates.maxLlmCalls = Number(input.maxLlmCalls);
      if (input.maxToolCalls !== undefined) updates.maxToolCalls = Number(input.maxToolCalls);
      if (input.maxDurationMs !== undefined) updates.maxDurationMs = Number(input.maxDurationMs);

      if (Object.keys(updates).length === 0) {
        return 'No limits specified. Provide at least one limit to update.';
      }

      tracker.updateConfig({
        [limitsKey]: {
          ...(config as any)[limitsKey],
          ...updates,
        },
      });

      return `Budget limits updated for ${scope} scope:\n${JSON.stringify(updates, null, 2)}`;
    },

    budget_reset: async (input) => {
      const tracker = getBudgetTracker();
      if (!tracker) {
        return 'Budget tracking is not enabled.';
      }

      const scope = String(input.scope || 'session');

      if (scope === 'all') {
        tracker.resetAll();
        return 'All budget counters have been reset.';
      }

      tracker.resetUsage(scope as BudgetScope);
      return `Budget counters reset for ${scope} scope.`;
    },
  };
}

/**
 * All budget tools
 */
export const budgetTools: Tool[] = [
  budgetStatusTool,
  budgetGetTool,
  budgetSetTool,
  budgetResetTool,
];

/**
 * Register budget tools with a tool registry
 */
export function registerBudgetTools(
  registry: ToolRegistry,
  getBudgetTracker: () => BudgetTracker | null
): void {
  const executors = createBudgetToolExecutors(getBudgetTracker);

  for (const tool of budgetTools) {
    registry.register(tool, executors[tool.name]);
  }
}

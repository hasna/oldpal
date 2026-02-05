import type { BudgetConfig, BudgetLimits } from '@hasna/assistants-shared';

/**
 * Default budget limits for a session
 * These are generous defaults that prevent runaway usage
 */
export const DEFAULT_SESSION_LIMITS: BudgetLimits = {
  maxTotalTokens: 1_000_000, // 1M tokens per session
  maxLlmCalls: 500,          // 500 LLM calls per session
  maxToolCalls: 1000,        // 1000 tool calls per session
  maxDurationMs: 4 * 60 * 60 * 1000, // 4 hours
  period: 'session',
};

/**
 * Default budget limits for an agent
 */
export const DEFAULT_AGENT_LIMITS: BudgetLimits = {
  maxTotalTokens: 500_000, // 500K tokens per agent
  maxLlmCalls: 100,        // 100 LLM calls per agent task
  maxToolCalls: 200,       // 200 tool calls per agent task
  maxDurationMs: 30 * 60 * 1000, // 30 minutes
  period: 'session',
};

/**
 * Default budget limits for a swarm
 */
export const DEFAULT_SWARM_LIMITS: BudgetLimits = {
  maxTotalTokens: 2_000_000, // 2M tokens per swarm operation
  maxLlmCalls: 1000,         // 1000 LLM calls per swarm
  maxToolCalls: 2000,        // 2000 tool calls per swarm
  maxDurationMs: 60 * 60 * 1000, // 1 hour
  period: 'session',
};

/**
 * Default budget configuration
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  enabled: false, // Disabled by default
  session: DEFAULT_SESSION_LIMITS,
  agent: DEFAULT_AGENT_LIMITS,
  swarm: DEFAULT_SWARM_LIMITS,
  onExceeded: 'warn',
  persist: false,
};

/**
 * Warning threshold (percentage of limit)
 */
export const WARNING_THRESHOLD = 0.8; // Warn at 80%

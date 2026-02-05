import type { BudgetConfig, BudgetLimits, BudgetUsage } from '@hasna/assistants-shared';
import type { BudgetScope, BudgetCheckResult, BudgetStatus, BudgetUpdate } from './types';
import { DEFAULT_BUDGET_CONFIG, WARNING_THRESHOLD } from './defaults';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

/**
 * Creates a fresh usage object
 */
function createEmptyUsage(): BudgetUsage {
  const now = new Date().toISOString();
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    llmCalls: 0,
    toolCalls: 0,
    durationMs: 0,
    periodStartedAt: now,
    lastUpdatedAt: now,
  };
}

/**
 * Persisted budget state
 */
interface PersistedBudgetState {
  version: number;
  session: BudgetUsage;
  agents: Record<string, BudgetUsage>;
  swarm: BudgetUsage;
}

const PERSISTENCE_VERSION = 1;

/**
 * Budget tracker for monitoring resource usage against limits
 */
export class BudgetTracker {
  private config: BudgetConfig;
  private sessionUsage: BudgetUsage;
  private agentUsages: Map<string, BudgetUsage> = new Map();
  private swarmUsage: BudgetUsage;
  private sessionId: string;

  constructor(sessionId: string, config?: Partial<BudgetConfig>) {
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
    this.sessionUsage = createEmptyUsage();
    this.swarmUsage = createEmptyUsage();

    // Load persisted state if enabled
    if (this.config.persist) {
      this.loadState();
    }
  }

  private getStatePath(): string {
    const envHome = process.env.HOME || process.env.USERPROFILE || homedir();
    return join(envHome, '.assistants', 'budget', `${this.sessionId}.json`);
  }

  private loadState(): void {
    try {
      const statePath = this.getStatePath();
      if (!existsSync(statePath)) return;

      const data = JSON.parse(readFileSync(statePath, 'utf-8')) as PersistedBudgetState;
      if (data.version !== PERSISTENCE_VERSION) return;

      this.sessionUsage = data.session;
      this.swarmUsage = data.swarm;
      for (const [agentId, usage] of Object.entries(data.agents)) {
        this.agentUsages.set(agentId, usage);
      }
    } catch {
      // Failed to load state, start fresh
    }
  }

  private saveState(): void {
    if (!this.config.persist) return;

    try {
      const statePath = this.getStatePath();
      const stateDir = dirname(statePath);
      if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
      }

      const state: PersistedBudgetState = {
        version: PERSISTENCE_VERSION,
        session: this.sessionUsage,
        agents: Object.fromEntries(this.agentUsages),
        swarm: this.swarmUsage,
      };

      writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch {
      // Failed to save state, non-critical
    }
  }

  /**
   * Check if budget enforcement is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled ?? false;
  }

  /**
   * Enable or disable budget enforcement
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Get the current configuration
   */
  getConfig(): BudgetConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Check a single limit
   */
  private checkLimit(
    current: number,
    limit: number | undefined,
    name: string
  ): BudgetCheckResult {
    if (limit === undefined) {
      return { exceeded: false };
    }

    const percentUsed = (current / limit) * 100;
    const exceeded = current >= limit;
    const result: BudgetCheckResult = {
      exceeded,
      currentValue: current,
      limitValue: limit,
      percentUsed: Math.round(percentUsed * 10) / 10,
    };

    if (exceeded) {
      result.limitExceeded = name as keyof BudgetLimits;
    } else if (percentUsed >= WARNING_THRESHOLD * 100) {
      result.warning = `Approaching ${name} limit: ${Math.round(percentUsed)}% used`;
    }

    return result;
  }

  /**
   * Check budget for a scope
   */
  checkBudget(scope: BudgetScope, agentId?: string): BudgetStatus {
    let limits: BudgetLimits;
    let usage: BudgetUsage;

    switch (scope) {
      case 'session':
        limits = this.config.session || {};
        usage = this.sessionUsage;
        break;
      case 'agent':
        limits = this.config.agent || {};
        usage = agentId
          ? (this.agentUsages.get(agentId) || createEmptyUsage())
          : createEmptyUsage();
        break;
      case 'swarm':
        limits = this.config.swarm || {};
        usage = this.swarmUsage;
        break;
    }

    const checks = {
      inputTokens: this.checkLimit(usage.inputTokens, limits.maxInputTokens, 'inputTokens'),
      outputTokens: this.checkLimit(usage.outputTokens, limits.maxOutputTokens, 'outputTokens'),
      totalTokens: this.checkLimit(usage.totalTokens, limits.maxTotalTokens, 'totalTokens'),
      llmCalls: this.checkLimit(usage.llmCalls, limits.maxLlmCalls, 'llmCalls'),
      toolCalls: this.checkLimit(usage.toolCalls, limits.maxToolCalls, 'toolCalls'),
      durationMs: this.checkLimit(usage.durationMs, limits.maxDurationMs, 'durationMs'),
    };

    const overallExceeded = Object.values(checks).some((c) => c.exceeded);
    const warningsCount = Object.values(checks).filter((c) => c.warning).length;

    return {
      scope,
      limits,
      usage,
      checks,
      overallExceeded,
      warningsCount,
    };
  }

  /**
   * Quick check if any budget is exceeded
   */
  isExceeded(scope: BudgetScope = 'session', agentId?: string): boolean {
    if (!this.config.enabled) return false;
    return this.checkBudget(scope, agentId).overallExceeded;
  }

  /**
   * Record usage
   */
  recordUsage(update: BudgetUpdate, scope: BudgetScope = 'session', agentId?: string): void {
    const now = new Date().toISOString();

    // Update session usage
    this.sessionUsage = {
      ...this.sessionUsage,
      inputTokens: this.sessionUsage.inputTokens + (update.inputTokens || 0),
      outputTokens: this.sessionUsage.outputTokens + (update.outputTokens || 0),
      totalTokens: this.sessionUsage.totalTokens + (update.totalTokens || 0),
      llmCalls: this.sessionUsage.llmCalls + (update.llmCalls || 0),
      toolCalls: this.sessionUsage.toolCalls + (update.toolCalls || 0),
      durationMs: this.sessionUsage.durationMs + (update.durationMs || 0),
      lastUpdatedAt: now,
    };

    // Update agent usage if specified
    if (scope === 'agent' && agentId) {
      const agentUsage = this.agentUsages.get(agentId) || createEmptyUsage();
      this.agentUsages.set(agentId, {
        ...agentUsage,
        inputTokens: agentUsage.inputTokens + (update.inputTokens || 0),
        outputTokens: agentUsage.outputTokens + (update.outputTokens || 0),
        totalTokens: agentUsage.totalTokens + (update.totalTokens || 0),
        llmCalls: agentUsage.llmCalls + (update.llmCalls || 0),
        toolCalls: agentUsage.toolCalls + (update.toolCalls || 0),
        durationMs: agentUsage.durationMs + (update.durationMs || 0),
        lastUpdatedAt: now,
      });
    }

    // Update swarm usage if in swarm scope
    if (scope === 'swarm') {
      this.swarmUsage = {
        ...this.swarmUsage,
        inputTokens: this.swarmUsage.inputTokens + (update.inputTokens || 0),
        outputTokens: this.swarmUsage.outputTokens + (update.outputTokens || 0),
        totalTokens: this.swarmUsage.totalTokens + (update.totalTokens || 0),
        llmCalls: this.swarmUsage.llmCalls + (update.llmCalls || 0),
        toolCalls: this.swarmUsage.toolCalls + (update.toolCalls || 0),
        durationMs: this.swarmUsage.durationMs + (update.durationMs || 0),
        lastUpdatedAt: now,
      };
    }

    // Persist if enabled
    this.saveState();
  }

  /**
   * Record an LLM call
   */
  recordLlmCall(inputTokens: number, outputTokens: number, durationMs: number, agentId?: string): void {
    this.recordUsage(
      {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        llmCalls: 1,
        durationMs,
      },
      agentId ? 'agent' : 'session',
      agentId
    );
  }

  /**
   * Record a tool call
   */
  recordToolCall(durationMs: number, agentId?: string): void {
    this.recordUsage(
      {
        toolCalls: 1,
        durationMs,
      },
      agentId ? 'agent' : 'session',
      agentId
    );
  }

  /**
   * Get usage for a scope
   */
  getUsage(scope: BudgetScope = 'session', agentId?: string): BudgetUsage {
    switch (scope) {
      case 'session':
        return { ...this.sessionUsage };
      case 'agent':
        return agentId
          ? { ...(this.agentUsages.get(agentId) || createEmptyUsage()) }
          : createEmptyUsage();
      case 'swarm':
        return { ...this.swarmUsage };
    }
  }

  /**
   * Get all agent usages
   */
  getAgentUsages(): Map<string, BudgetUsage> {
    return new Map(this.agentUsages);
  }

  /**
   * Reset usage for a scope
   */
  resetUsage(scope: BudgetScope = 'session', agentId?: string): void {
    const newUsage = createEmptyUsage();

    switch (scope) {
      case 'session':
        this.sessionUsage = newUsage;
        break;
      case 'agent':
        if (agentId) {
          this.agentUsages.set(agentId, newUsage);
        }
        break;
      case 'swarm':
        this.swarmUsage = newUsage;
        break;
    }

    this.saveState();
  }

  /**
   * Reset all usage
   */
  resetAll(): void {
    this.sessionUsage = createEmptyUsage();
    this.agentUsages.clear();
    this.swarmUsage = createEmptyUsage();
    this.saveState();
  }

  /**
   * Get summary for display
   */
  getSummary(): {
    enabled: boolean;
    session: BudgetStatus;
    swarm: BudgetStatus;
    agentCount: number;
    anyExceeded: boolean;
    totalWarnings: number;
  } {
    const session = this.checkBudget('session');
    const swarm = this.checkBudget('swarm');

    let totalWarnings = session.warningsCount + swarm.warningsCount;
    let anyExceeded = session.overallExceeded || swarm.overallExceeded;

    for (const agentId of this.agentUsages.keys()) {
      const agentStatus = this.checkBudget('agent', agentId);
      totalWarnings += agentStatus.warningsCount;
      if (agentStatus.overallExceeded) {
        anyExceeded = true;
      }
    }

    return {
      enabled: this.config.enabled ?? false,
      session,
      swarm,
      agentCount: this.agentUsages.size,
      anyExceeded,
      totalWarnings,
    };
  }

  /**
   * Format usage for display
   */
  formatUsage(scope: BudgetScope = 'session', agentId?: string): string {
    const status = this.checkBudget(scope, agentId);
    const lines: string[] = [];

    lines.push(`Budget Status (${scope}${agentId ? `: ${agentId}` : ''}):`);
    lines.push(`  Enabled: ${this.config.enabled ? 'Yes' : 'No'}`);
    lines.push('');

    if (status.limits.maxTotalTokens) {
      const pct = status.checks.totalTokens?.percentUsed || 0;
      lines.push(`  Tokens: ${status.usage.totalTokens.toLocaleString()} / ${status.limits.maxTotalTokens.toLocaleString()} (${pct}%)`);
    } else {
      lines.push(`  Tokens: ${status.usage.totalTokens.toLocaleString()} (no limit)`);
    }

    if (status.limits.maxLlmCalls) {
      const pct = status.checks.llmCalls?.percentUsed || 0;
      lines.push(`  LLM Calls: ${status.usage.llmCalls} / ${status.limits.maxLlmCalls} (${pct}%)`);
    } else {
      lines.push(`  LLM Calls: ${status.usage.llmCalls} (no limit)`);
    }

    if (status.limits.maxToolCalls) {
      const pct = status.checks.toolCalls?.percentUsed || 0;
      lines.push(`  Tool Calls: ${status.usage.toolCalls} / ${status.limits.maxToolCalls} (${pct}%)`);
    } else {
      lines.push(`  Tool Calls: ${status.usage.toolCalls} (no limit)`);
    }

    const durationMin = Math.round(status.usage.durationMs / 60000);
    if (status.limits.maxDurationMs) {
      const limitMin = Math.round(status.limits.maxDurationMs / 60000);
      const pct = status.checks.durationMs?.percentUsed || 0;
      lines.push(`  Duration: ${durationMin}min / ${limitMin}min (${pct}%)`);
    } else {
      lines.push(`  Duration: ${durationMin}min (no limit)`);
    }

    if (status.overallExceeded) {
      lines.push('');
      lines.push('  ⚠️  BUDGET EXCEEDED');
    }

    return lines.join('\n');
  }
}

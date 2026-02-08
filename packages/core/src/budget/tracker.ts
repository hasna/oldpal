import type { BudgetConfig, BudgetLimits, BudgetUsage } from '@hasna/assistants-shared';
import type { BudgetScope, BudgetCheckResult, BudgetStatus, BudgetUpdate } from './types';
import { DEFAULT_BUDGET_CONFIG, WARNING_THRESHOLD } from './defaults';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { atomicWriteFileSync } from '../utils/atomic-write';

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
  assistants: Record<string, BudgetUsage>;
  swarm: BudgetUsage;
  projects?: Record<string, BudgetUsage>;
}

const PERSISTENCE_VERSION = 2;

/**
 * Budget tracker for monitoring resource usage against limits
 */
export class BudgetTracker {
  private config: BudgetConfig;
  private sessionUsage: BudgetUsage;
  private assistantUsages: Map<string, BudgetUsage> = new Map();
  private swarmUsage: BudgetUsage;
  private projectUsages: Map<string, BudgetUsage> = new Map();
  private sessionId: string;
  private activeProjectId: string | null = null;

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

  private getProjectStatePath(projectId: string): string {
    const envHome = process.env.HOME || process.env.USERPROFILE || homedir();
    return join(envHome, '.assistants', 'budget', `project-${projectId}.json`);
  }

  private loadState(): void {
    try {
      const statePath = this.getStatePath();
      if (!existsSync(statePath)) return;

      const data = JSON.parse(readFileSync(statePath, 'utf-8')) as PersistedBudgetState;
      if (data.version !== PERSISTENCE_VERSION && data.version !== 1) return;

      this.sessionUsage = data.session;
      this.swarmUsage = data.swarm;
      // Backwards compat: old files use 'agents' key
      const assistantData = data.assistants || (data as unknown as Record<string, Record<string, BudgetUsage>>).agents || {};
      for (const [assistantId, usage] of Object.entries(assistantData)) {
        this.assistantUsages.set(assistantId, usage);
      }
      // Load project data if present
      if (data.projects) {
        for (const [projectId, usage] of Object.entries(data.projects)) {
          this.projectUsages.set(projectId, usage);
        }
      }
    } catch {
      // Failed to load state, start fresh
    }
  }

  private loadProjectState(projectId: string): BudgetUsage {
    try {
      const statePath = this.getProjectStatePath(projectId);
      if (!existsSync(statePath)) return createEmptyUsage();
      const data = JSON.parse(readFileSync(statePath, 'utf-8')) as BudgetUsage;
      return data;
    } catch {
      return createEmptyUsage();
    }
  }

  private saveProjectState(projectId: string, usage: BudgetUsage): void {
    if (!this.config.persist) return;
    try {
      const statePath = this.getProjectStatePath(projectId);
      const stateDir = dirname(statePath);
      if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
      }
      atomicWriteFileSync(statePath, JSON.stringify(usage, null, 2));
    } catch {
      // Non-critical
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
        assistants: Object.fromEntries(this.assistantUsages),
        swarm: this.swarmUsage,
        projects: Object.fromEntries(this.projectUsages),
      };

      atomicWriteFileSync(statePath, JSON.stringify(state, null, 2));
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
   * Set the active project for automatic project budget tracking
   */
  setActiveProject(projectId: string | null): void {
    this.activeProjectId = projectId;
    if (projectId && !this.projectUsages.has(projectId)) {
      // Load from persistent storage or create new
      const usage = this.config.persist ? this.loadProjectState(projectId) : createEmptyUsage();
      this.projectUsages.set(projectId, usage);
    }
  }

  /**
   * Get the active project ID
   */
  getActiveProject(): string | null {
    return this.activeProjectId;
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
  checkBudget(scope: BudgetScope, idOrAssistant?: string): BudgetStatus {
    let limits: BudgetLimits;
    let usage: BudgetUsage;

    switch (scope) {
      case 'session':
        limits = this.config.session || {};
        usage = this.sessionUsage;
        break;
      case 'assistant':
        limits = this.config.assistant || {};
        usage = idOrAssistant
          ? (this.assistantUsages.get(idOrAssistant) || createEmptyUsage())
          : createEmptyUsage();
        break;
      case 'swarm':
        limits = this.config.swarm || {};
        usage = this.swarmUsage;
        break;
      case 'project':
        limits = this.config.project || {};
        usage = idOrAssistant
          ? (this.projectUsages.get(idOrAssistant) || createEmptyUsage())
          : (this.activeProjectId
            ? (this.projectUsages.get(this.activeProjectId) || createEmptyUsage())
            : createEmptyUsage());
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
  isExceeded(scope: BudgetScope = 'session', idOrAssistant?: string): boolean {
    if (!this.config.enabled) return false;
    return this.checkBudget(scope, idOrAssistant).overallExceeded;
  }

  /**
   * Check if any active scope budget is exceeded (session + project)
   */
  isAnyExceeded(): boolean {
    if (!this.config.enabled) return false;
    if (this.isExceeded('session')) return true;
    if (this.activeProjectId && this.isExceeded('project', this.activeProjectId)) return true;
    return false;
  }

  /**
   * Record usage
   */
  recordUsage(update: BudgetUpdate, scope: BudgetScope = 'session', idOrAssistant?: string): void {
    const now = new Date().toISOString();

    // Update session usage (always)
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

    // Update assistant usage if specified
    if (scope === 'assistant' && idOrAssistant) {
      const assistantUsage = this.assistantUsages.get(idOrAssistant) || createEmptyUsage();
      this.assistantUsages.set(idOrAssistant, {
        ...assistantUsage,
        inputTokens: assistantUsage.inputTokens + (update.inputTokens || 0),
        outputTokens: assistantUsage.outputTokens + (update.outputTokens || 0),
        totalTokens: assistantUsage.totalTokens + (update.totalTokens || 0),
        llmCalls: assistantUsage.llmCalls + (update.llmCalls || 0),
        toolCalls: assistantUsage.toolCalls + (update.toolCalls || 0),
        durationMs: assistantUsage.durationMs + (update.durationMs || 0),
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

    // Update project usage if active
    if (this.activeProjectId) {
      const projectId = (scope === 'project' && idOrAssistant) ? idOrAssistant : this.activeProjectId;
      const projectUsage = this.projectUsages.get(projectId) || createEmptyUsage();
      const updatedProject = {
        ...projectUsage,
        inputTokens: projectUsage.inputTokens + (update.inputTokens || 0),
        outputTokens: projectUsage.outputTokens + (update.outputTokens || 0),
        totalTokens: projectUsage.totalTokens + (update.totalTokens || 0),
        llmCalls: projectUsage.llmCalls + (update.llmCalls || 0),
        toolCalls: projectUsage.toolCalls + (update.toolCalls || 0),
        durationMs: projectUsage.durationMs + (update.durationMs || 0),
        lastUpdatedAt: now,
      };
      this.projectUsages.set(projectId, updatedProject);
      this.saveProjectState(projectId, updatedProject);
    }

    // Persist if enabled
    this.saveState();
  }

  /**
   * Record an LLM call
   */
  recordLlmCall(inputTokens: number, outputTokens: number, durationMs: number, assistantId?: string): void {
    this.recordUsage(
      {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        llmCalls: 1,
        durationMs,
      },
      assistantId ? 'assistant' : 'session',
      assistantId
    );
  }

  /**
   * Record a tool call
   */
  recordToolCall(durationMs: number, assistantId?: string): void {
    this.recordUsage(
      {
        toolCalls: 1,
        durationMs,
      },
      assistantId ? 'assistant' : 'session',
      assistantId
    );
  }

  /**
   * Get usage for a scope
   */
  getUsage(scope: BudgetScope = 'session', idOrAssistant?: string): BudgetUsage {
    switch (scope) {
      case 'session':
        return { ...this.sessionUsage };
      case 'assistant':
        return idOrAssistant
          ? { ...(this.assistantUsages.get(idOrAssistant) || createEmptyUsage()) }
          : createEmptyUsage();
      case 'swarm':
        return { ...this.swarmUsage };
      case 'project':
        const projectId = idOrAssistant || this.activeProjectId;
        return projectId
          ? { ...(this.projectUsages.get(projectId) || createEmptyUsage()) }
          : createEmptyUsage();
    }
  }

  /**
   * Get all assistant usages
   */
  getAssistantUsages(): Map<string, BudgetUsage> {
    return new Map(this.assistantUsages);
  }

  /**
   * Get all project usages
   */
  getProjectUsages(): Map<string, BudgetUsage> {
    return new Map(this.projectUsages);
  }

  /**
   * Reset usage for a scope
   */
  resetUsage(scope: BudgetScope = 'session', idOrAssistant?: string): void {
    const newUsage = createEmptyUsage();

    switch (scope) {
      case 'session':
        this.sessionUsage = newUsage;
        break;
      case 'assistant':
        if (idOrAssistant) {
          this.assistantUsages.set(idOrAssistant, newUsage);
        }
        break;
      case 'swarm':
        this.swarmUsage = newUsage;
        break;
      case 'project':
        const projectId = idOrAssistant || this.activeProjectId;
        if (projectId) {
          this.projectUsages.set(projectId, newUsage);
          this.saveProjectState(projectId, newUsage);
        }
        break;
    }

    this.saveState();
  }

  /**
   * Reset all usage
   */
  resetAll(): void {
    this.sessionUsage = createEmptyUsage();
    this.assistantUsages.clear();
    this.swarmUsage = createEmptyUsage();
    this.projectUsages.clear();
    this.saveState();
  }

  /**
   * Extend budget limits for a scope (increase without resetting)
   */
  extendLimits(scope: BudgetScope, additionalTokens: number): void {
    let limits: BudgetLimits | undefined;
    switch (scope) {
      case 'session': limits = this.config.session; break;
      case 'assistant': limits = this.config.assistant; break;
      case 'swarm': limits = this.config.swarm; break;
      case 'project': limits = this.config.project; break;
    }
    if (limits && limits.maxTotalTokens) {
      limits.maxTotalTokens += additionalTokens;
    }
  }

  /**
   * Get summary for display
   */
  getSummary(): {
    enabled: boolean;
    session: BudgetStatus;
    swarm: BudgetStatus;
    project: BudgetStatus | null;
    assistantCount: number;
    anyExceeded: boolean;
    totalWarnings: number;
  } {
    const session = this.checkBudget('session');
    const swarm = this.checkBudget('swarm');
    const project = this.activeProjectId
      ? this.checkBudget('project', this.activeProjectId)
      : null;

    let totalWarnings = session.warningsCount + swarm.warningsCount;
    let anyExceeded = session.overallExceeded || swarm.overallExceeded;

    if (project) {
      totalWarnings += project.warningsCount;
      if (project.overallExceeded) anyExceeded = true;
    }

    for (const assistantId of this.assistantUsages.keys()) {
      const assistantStatus = this.checkBudget('assistant', assistantId);
      totalWarnings += assistantStatus.warningsCount;
      if (assistantStatus.overallExceeded) {
        anyExceeded = true;
      }
    }

    return {
      enabled: this.config.enabled ?? false,
      session,
      swarm,
      project,
      assistantCount: this.assistantUsages.size,
      anyExceeded,
      totalWarnings,
    };
  }

  /**
   * Format usage for display
   */
  formatUsage(scope: BudgetScope = 'session', idOrAssistant?: string): string {
    const status = this.checkBudget(scope, idOrAssistant);
    const lines: string[] = [];

    lines.push(`Budget Status (${scope}${idOrAssistant ? `: ${idOrAssistant}` : ''}):`);
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

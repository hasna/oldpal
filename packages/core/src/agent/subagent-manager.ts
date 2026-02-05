/**
 * Subagent Manager
 *
 * Manages the lifecycle of spawned subagents including:
 * - Recursion depth limiting
 * - Concurrent agent limiting
 * - Resource budgeting
 * - Async job tracking
 */

import { generateId } from '@hasna/assistants-shared';
import type { StreamChunk, Tool, HookInput, HookOutput } from '@hasna/assistants-shared';
import type { LLMClient } from '../llm/client';

// ============================================
// Types
// ============================================

export interface SubagentConfig {
  /** The task/instruction for the subagent to complete */
  task: string;
  /** List of tool names the subagent can use */
  tools?: string[];
  /** Additional context to pass to the subagent */
  context?: string;
  /** Maximum turns the subagent can take (default: 10, max: 25) */
  maxTurns?: number;
  /** Model to use for subagent (default: inherit from parent) */
  model?: string;
  /** Run asynchronously and return job ID (default: false) */
  async?: boolean;
  /** Parent session ID */
  parentSessionId: string;
  /** Current depth level (0 = root agent) */
  depth: number;
  /** Working directory */
  cwd: string;
}

export interface SubagentResult {
  /** Whether the subagent completed successfully */
  success: boolean;
  /** The result content from the subagent */
  result?: string;
  /** Error message if failed */
  error?: string;
  /** Number of turns the subagent took */
  turns: number;
  /** Number of tool calls made */
  toolCalls: number;
  /** Total tokens used (input + output) */
  tokensUsed?: number;
  /** The unique ID of the subagent that produced this result */
  subagentId?: string;
}

export interface SubagentInfo {
  id: string;
  task: string;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  startedAt: number;
  completedAt?: number;
  result?: SubagentResult;
  depth: number;
}

export type SubagentJobStatus = 'running' | 'completed' | 'failed' | 'timeout';

export interface SubagentJob {
  id: string;
  status: SubagentJobStatus;
  config: SubagentConfig;
  startedAt: number;
  completedAt?: number;
  result?: SubagentResult;
}

export interface SubagentManagerConfig {
  /** Maximum recursion depth (default: 3) */
  maxDepth?: number;
  /** Maximum concurrent subagents per parent (default: 5) */
  maxConcurrent?: number;
  /** Maximum turns per subagent (default: 10) */
  maxTurns?: number;
  /** Default timeout in ms (default: 120000 = 2 minutes) */
  defaultTimeoutMs?: number;
  /** Default tools for subagents */
  defaultTools?: string[];
  /** Tools that subagents cannot use */
  forbiddenTools?: string[];
}

export interface SubagentManagerContext {
  /** Function to create a subagent loop */
  createSubagentLoop: (config: SubagentLoopConfig) => Promise<SubagentRunner>;
  /** Get available tools */
  getTools: () => Tool[];
  /** Get parent's allowed tools (null = all allowed) */
  getParentAllowedTools: () => Set<string> | null;
  /** Get LLM client (for reference only - subagents should create their own) */
  getLLMClient: () => LLMClient | null;
  /** Get LLM config to create a new client for subagents (avoids sharing client) */
  getLLMConfig?: () => import('@hasna/assistants-shared').LLMConfig | null;
  /** Fire a hook and return the result (optional - for SubagentStart/Stop hooks) */
  fireHook?: (input: HookInput) => Promise<HookOutput | null>;
}

export interface SubagentLoopConfig {
  task: string;
  tools: string[];
  context?: string;
  maxTurns: number;
  cwd: string;
  sessionId: string;
  depth: number;
  llmClient?: LLMClient;
  onChunk?: (chunk: StreamChunk) => void;
}

export interface SubagentRunner {
  run(): Promise<SubagentResult>;
  stop(): void;
}

// ============================================
// Constants
// ============================================

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_CONCURRENT = 5;
const DEFAULT_MAX_TURNS = 10;
const MAX_ALLOWED_TURNS = 25;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

const DEFAULT_SUBAGENT_TOOLS = [
  'read',
  'glob',
  'grep',
  'bash',
  'web_search',
  'web_fetch',
];

const FORBIDDEN_SUBAGENT_TOOLS = [
  'agent_spawn',      // Prevent recursive spawning at max depth
  'agent_delegate',   // Prevent delegation at max depth
  'wallet_get',       // No wallet access
  'wallet_list',
  'secrets_get',      // No secrets access
  'secrets_list',
  'schedule_create',  // No scheduling
  'schedule_update',
  'schedule_delete',
];

// ============================================
// SubagentManager Class
// ============================================

export class SubagentManager {
  private config: Required<SubagentManagerConfig>;
  private activeSubagents: Map<string, SubagentInfo> = new Map();
  private activeRunners: Map<string, SubagentRunner> = new Map();
  private activeTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private asyncJobs: Map<string, SubagentJob> = new Map();
  private context: SubagentManagerContext;

  constructor(config: SubagentManagerConfig, context: SubagentManagerContext) {
    this.config = {
      maxDepth: config.maxDepth ?? DEFAULT_MAX_DEPTH,
      maxConcurrent: config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      maxTurns: config.maxTurns ?? DEFAULT_MAX_TURNS,
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      defaultTools: config.defaultTools ?? DEFAULT_SUBAGENT_TOOLS,
      forbiddenTools: config.forbiddenTools ?? FORBIDDEN_SUBAGENT_TOOLS,
    };
    this.context = context;
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<SubagentManagerConfig> {
    return { ...this.config };
  }

  /**
   * Check if we can spawn a new subagent at the given depth
   */
  canSpawn(depth: number): { allowed: boolean; reason?: string } {
    // Check depth limit
    if (depth >= this.config.maxDepth) {
      return {
        allowed: false,
        reason: `Maximum subagent depth (${this.config.maxDepth}) exceeded`,
      };
    }

    // Check concurrent limit
    const activeCount = this.activeSubagents.size;
    if (activeCount >= this.config.maxConcurrent) {
      return {
        allowed: false,
        reason: `Maximum concurrent subagents (${this.config.maxConcurrent}) reached`,
      };
    }

    return { allowed: true };
  }

  /**
   * Filter tools for subagent based on depth, configuration, and parent restrictions
   */
  filterToolsForSubagent(requestedTools: string[] | undefined, depth: number): string[] {
    // Start with requested tools or defaults
    let tools = requestedTools ?? this.config.defaultTools;

    // At max depth - 1, also forbid spawning tools to prevent depth violation
    const forbiddenSet = new Set(this.config.forbiddenTools);
    if (depth >= this.config.maxDepth - 1) {
      forbiddenSet.add('agent_spawn');
      forbiddenSet.add('agent_delegate');
    }

    // Filter out forbidden tools
    tools = tools.filter((tool) => !forbiddenSet.has(tool));

    // Validate against available tools
    const availableTools = new Set(this.context.getTools().map((t) => t.name));
    tools = tools.filter((tool) => availableTools.has(tool));

    // SECURITY: Intersect with parent's allowed tools to prevent privilege escalation
    // A subagent should never have access to tools its parent doesn't have
    const parentAllowed = this.context.getParentAllowedTools();
    if (parentAllowed) {
      tools = tools.filter((tool) => parentAllowed.has(tool.toLowerCase()));
    }

    return tools;
  }

  /**
   * Spawn a subagent synchronously
   */
  async spawn(config: SubagentConfig): Promise<SubagentResult> {
    const subagentId = generateId();

    // Check limits
    const canSpawnResult = this.canSpawn(config.depth);
    if (!canSpawnResult.allowed) {
      return {
        success: false,
        error: canSpawnResult.reason,
        turns: 0,
        toolCalls: 0,
        subagentId,
      };
    }

    // Fire SubagentStart hook if available
    if (this.context.fireHook) {
      const hookInput: HookInput = {
        session_id: config.parentSessionId,
        hook_event_name: 'SubagentStart',
        cwd: config.cwd,
        subagent_id: subagentId,
        parent_session_id: config.parentSessionId,
        task: config.task,
        allowed_tools: config.tools ?? this.config.defaultTools,
        max_turns: config.maxTurns ?? this.config.maxTurns,
        depth: config.depth,
      };

      const hookResult = await this.context.fireHook(hookInput);

      // Hook can block subagent creation
      if (hookResult && hookResult.continue === false) {
        return {
          success: false,
          error: hookResult.stopReason || 'Blocked by SubagentStart hook',
          turns: 0,
          toolCalls: 0,
          subagentId,
        };
      }

      // Hook can modify allowed_tools via updatedInput
      if (hookResult?.updatedInput?.allowed_tools) {
        config = {
          ...config,
          tools: hookResult.updatedInput.allowed_tools as string[],
        };
      }

      // Hook can add context via additionalContext
      if (hookResult?.additionalContext) {
        config = {
          ...config,
          context: config.context
            ? `${config.context}\n\n${hookResult.additionalContext}`
            : hookResult.additionalContext,
        };
      }
    }

    const info: SubagentInfo = {
      id: subagentId,
      task: config.task,
      status: 'running',
      startedAt: Date.now(),
      depth: config.depth,
    };

    this.activeSubagents.set(subagentId, info);

    try {
      // Filter tools
      const tools = this.filterToolsForSubagent(config.tools, config.depth);

      // Clamp max turns
      const maxTurns = Math.min(
        config.maxTurns ?? this.config.maxTurns,
        MAX_ALLOWED_TURNS
      );

      // Create and run subagent
      // Note: We don't pass the parent LLM client to avoid concurrency issues
      // when multiple subagents run in parallel. Each subagent creates its own client.
      const runner = await this.context.createSubagentLoop({
        task: config.task,
        tools,
        context: config.context,
        maxTurns,
        cwd: config.cwd,
        sessionId: `subagent-${subagentId}`,
        depth: config.depth + 1,
        // llmClient intentionally not passed - subagent creates its own
      });

      // Track the runner so we can stop it if needed
      this.activeRunners.set(subagentId, runner);

      // Run with timeout
      const result = await Promise.race([
        runner.run(),
        this.createTimeout(this.config.defaultTimeoutMs, runner, subagentId),
      ]);

      // Update info - detect timeout from error message
      if (result.success) {
        info.status = 'completed';
      } else if (result.error?.includes('timed out')) {
        info.status = 'timeout';
      } else {
        info.status = 'failed';
      }
      info.completedAt = Date.now();
      info.result = result;

      // Fire SubagentStop hook
      const finalResult = await this.fireSubagentStopHook(
        subagentId,
        config,
        info,
        result
      );

      return finalResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      info.status = 'failed';
      info.completedAt = Date.now();
      info.result = {
        success: false,
        error: errorMessage,
        turns: 0,
        toolCalls: 0,
        subagentId,
      };

      // Fire SubagentStop hook for error case too
      const finalResult = await this.fireSubagentStopHook(
        subagentId,
        config,
        info,
        info.result
      );
      return finalResult;
    } finally {
      // Clean up all tracking for this subagent
      this.cancelTimeout(subagentId);
      this.activeSubagents.delete(subagentId);
      this.activeRunners.delete(subagentId);
    }
  }

  /**
   * Stop a specific subagent by ID
   */
  stopSubagent(subagentId: string): boolean {
    const runner = this.activeRunners.get(subagentId);
    if (runner) {
      this.cancelTimeout(subagentId);
      runner.stop();
      return true;
    }
    return false;
  }

  /**
   * Stop all active subagents
   */
  stopAll(): number {
    let stopped = 0;
    for (const [id, runner] of this.activeRunners) {
      this.cancelTimeout(id);
      runner.stop();
      stopped++;
    }
    return stopped;
  }

  /**
   * Spawn a subagent asynchronously and return job ID
   */
  async spawnAsync(config: SubagentConfig): Promise<string> {
    // Check limits
    const canSpawnResult = this.canSpawn(config.depth);
    if (!canSpawnResult.allowed) {
      throw new Error(canSpawnResult.reason);
    }

    const jobId = generateId();
    const job: SubagentJob = {
      id: jobId,
      status: 'running',
      config,
      startedAt: Date.now(),
    };

    this.asyncJobs.set(jobId, job);

    // Run in background
    this.runAsyncJob(job).catch(() => {
      // Error is captured in job status
    });

    return jobId;
  }

  /**
   * Get status of an async job
   */
  getJobStatus(jobId: string): SubagentJob | null {
    return this.asyncJobs.get(jobId) ?? null;
  }

  /**
   * Wait for an async job to complete
   */
  async waitForJob(jobId: string, timeoutMs?: number): Promise<SubagentResult | null> {
    const job = this.asyncJobs.get(jobId);
    if (!job) return null;

    // If already done, return immediately
    if (job.status !== 'running') {
      return job.result ?? null;
    }

    const timeout = timeoutMs ?? 30000;
    const pollInterval = 500;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await this.sleep(pollInterval);

      const currentJob = this.asyncJobs.get(jobId);
      if (!currentJob) return null;

      if (currentJob.status !== 'running') {
        return currentJob.result ?? null;
      }
    }

    // Timeout waiting for job
    return null;
  }

  /**
   * List active subagents
   */
  listActive(): SubagentInfo[] {
    return Array.from(this.activeSubagents.values());
  }

  /**
   * List async jobs
   */
  listJobs(): SubagentJob[] {
    return Array.from(this.asyncJobs.values());
  }

  /**
   * Clean up old completed jobs
   */
  cleanupJobs(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, job] of this.asyncJobs) {
      if (job.status !== 'running' && job.completedAt) {
        if (now - job.completedAt > maxAgeMs) {
          this.asyncJobs.delete(id);
          cleaned++;
        }
      }
    }

    return cleaned;
  }

  // ============================================
  // Private Methods
  // ============================================

  private async runAsyncJob(job: SubagentJob): Promise<void> {
    try {
      const result = await this.spawn(job.config);
      // Detect timeout from error message
      if (result.success) {
        job.status = 'completed';
      } else if (result.error?.includes('timed out')) {
        job.status = 'timeout';
      } else {
        job.status = 'failed';
      }
      job.completedAt = Date.now();
      job.result = result;
    } catch (error) {
      job.status = 'failed';
      job.completedAt = Date.now();
      job.result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        turns: 0,
        toolCalls: 0,
      };
    }
  }

  /**
   * Fire SubagentStop hook and return potentially modified result
   */
  private async fireSubagentStopHook(
    subagentId: string,
    config: SubagentConfig,
    info: SubagentInfo,
    result: SubagentResult
  ): Promise<SubagentResult> {
    // Always ensure subagentId is included
    const resultWithId = { ...result, subagentId };

    if (!this.context.fireHook) {
      return resultWithId;
    }

    const hookInput: HookInput = {
      session_id: config.parentSessionId,
      hook_event_name: 'SubagentStop',
      cwd: config.cwd,
      subagent_id: subagentId,
      parent_session_id: config.parentSessionId,
      status: info.status,
      result: result.result,
      error: result.error,
      turns_used: result.turns,
      tool_calls: result.toolCalls,
      duration_ms: (info.completedAt ?? Date.now()) - info.startedAt,
      task: config.task,
    };

    const hookResult = await this.context.fireHook(hookInput);

    // Hook can block result from being used
    if (hookResult && hookResult.continue === false) {
      return {
        success: false,
        error: hookResult.stopReason || 'Result blocked by SubagentStop hook',
        turns: result.turns,
        toolCalls: result.toolCalls,
        subagentId,
      };
    }

    // Hook can modify the result via updatedInput
    if (hookResult?.updatedInput?.result !== undefined) {
      return {
        ...resultWithId,
        result: String(hookResult.updatedInput.result),
      };
    }

    return resultWithId;
  }

  private createTimeout(ms: number, runner: SubagentRunner, subagentId: string): Promise<SubagentResult> {
    return new Promise((resolve) => {
      const timerId = setTimeout(() => {
        // Clean up the timer reference
        this.activeTimeouts.delete(subagentId);
        runner.stop();
        resolve({
          success: false,
          error: `Subagent timed out after ${Math.round(ms / 1000)} seconds`,
          turns: 0,
          toolCalls: 0,
          subagentId,
        });
      }, ms);
      // Track the timer so we can cancel it if the runner completes first
      this.activeTimeouts.set(subagentId, timerId);
    });
  }

  /**
   * Cancel a timeout timer for a subagent
   */
  private cancelTimeout(subagentId: string): void {
    const timerId = this.activeTimeouts.get(subagentId);
    if (timerId) {
      clearTimeout(timerId);
      this.activeTimeouts.delete(subagentId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

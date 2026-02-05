/**
 * Swarm Coordinator
 *
 * Orchestrates multi-agent swarm execution using SubagentManager.
 * Implements the planner -> workers -> critic -> aggregator pattern.
 */

import { generateId } from '@hasna/assistants-shared';
import type { StreamChunk } from '@hasna/assistants-shared';
import type {
  SubagentManager,
  SubagentConfig,
  SubagentResult,
} from '../agent/subagent-manager';
import type { AgentRegistryService, RegisteredAgent } from '../registry';
import type {
  SwarmConfig,
  SwarmState,
  SwarmTask,
  SwarmPlan,
  SwarmResult,
  SwarmInput,
  SwarmEvent,
  SwarmEventListener,
  SwarmTaskStatus,
  SwarmStatus,
  SwarmRole,
  SwarmMetrics,
} from './types';
import { DEFAULT_SWARM_CONFIG, ROLE_SYSTEM_PROMPTS } from './types';

/**
 * Context required by the SwarmCoordinator
 */
export interface SwarmCoordinatorContext {
  /** SubagentManager for spawning agents */
  subagentManager: SubagentManager;
  /** Agent registry for agent selection */
  registry?: AgentRegistryService;
  /** Parent session ID */
  sessionId: string;
  /** Working directory */
  cwd: string;
  /** Current depth (0 = root) */
  depth: number;
  /** Stream chunk callback */
  onChunk?: (chunk: StreamChunk) => void;
}

/**
 * Swarm Coordinator
 */
export class SwarmCoordinator {
  private config: SwarmConfig;
  private context: SwarmCoordinatorContext;
  private state: SwarmState | null = null;
  private listeners: Set<SwarmEventListener> = new Set();
  private stopped = false;

  constructor(
    config: Partial<SwarmConfig>,
    context: SwarmCoordinatorContext
  ) {
    this.config = { ...DEFAULT_SWARM_CONFIG, ...config };
    this.context = context;
  }

  /**
   * Get current configuration
   */
  getConfig(): SwarmConfig {
    return { ...this.config };
  }

  /**
   * Get current state
   */
  getState(): SwarmState | null {
    return this.state ? { ...this.state } : null;
  }

  /**
   * Check if swarm is running
   */
  isRunning(): boolean {
    return this.state !== null && !['completed', 'failed', 'cancelled'].includes(this.state.status);
  }

  /**
   * Add event listener
   */
  addEventListener(listener: SwarmEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit event
   */
  private emit(type: SwarmEvent['type'], taskId?: string, data?: unknown): void {
    if (!this.state) return;

    const event: SwarmEvent = {
      type,
      swarmId: this.state.id,
      taskId,
      timestamp: Date.now(),
      data,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Stream text to parent
   */
  private streamText(text: string): void {
    if (this.context.onChunk) {
      this.context.onChunk({ type: 'text', content: text });
    }
  }

  /**
   * Execute swarm for a goal
   */
  async execute(input: SwarmInput): Promise<SwarmResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        error: 'Swarm mode is disabled',
        taskResults: {},
        metrics: this.createEmptyMetrics(),
        durationMs: 0,
      };
    }

    if (this.isRunning()) {
      return {
        success: false,
        error: 'Swarm is already running',
        taskResults: {},
        metrics: this.createEmptyMetrics(),
        durationMs: 0,
      };
    }

    // Apply input config overrides
    const config = { ...this.config, ...input.config };
    this.config = config;

    // Initialize state
    const swarmId = generateId();
    this.state = {
      id: swarmId,
      status: 'idle',
      plan: null,
      sessionId: this.context.sessionId,
      taskResults: new Map(),
      activeAgents: new Set(),
      errors: [],
      startedAt: Date.now(),
      metrics: this.createEmptyMetrics(),
    };
    this.stopped = false;

    this.emit('swarm:started');
    this.streamText(`\n🐝 Starting swarm for: ${input.goal}\n`);

    const startTime = Date.now();

    try {
      // Phase 1: Planning
      let plan: SwarmPlan;
      if (input.tasks && input.tasks.length > 0) {
        // Use pre-defined tasks
        plan = this.createPlanFromTasks(input.goal, input.tasks);
      } else {
        // Run planner agent
        this.updateStatus('planning');
        plan = await this.runPlanner(input.goal, input.context);
      }

      this.state.plan = plan;
      this.state.metrics.totalTasks = plan.tasks.length;
      this.emit('swarm:plan_created', undefined, plan);

      if (plan.tasks.length === 0) {
        throw new Error('Planner produced no tasks');
      }

      this.streamText(`\n📋 Plan created with ${plan.tasks.length} tasks\n`);

      // Phase 2: Approval (unless auto-approve)
      if (!config.autoApprove) {
        // In CLI mode, we'd prompt user here
        // For now, auto-approve (this will be enhanced in swarm status UI task)
        plan.approved = true;
        plan.approvedAt = Date.now();
      } else {
        plan.approved = true;
        plan.approvedAt = Date.now();
      }

      this.emit('swarm:plan_approved');

      // Phase 3: Execution
      this.updateStatus('executing');
      await this.executeTaskGraph(plan);

      // Phase 4: Critic review (optional)
      if (config.enableCritic && !this.stopped) {
        this.updateStatus('reviewing');
        await this.runCriticReview();
      }

      // Phase 5: Aggregation
      if (!this.stopped) {
        this.updateStatus('aggregating');
        const finalResult = await this.runAggregator(input.goal);
        this.state.finalResult = finalResult;
      }

      // Complete
      if (!this.stopped) {
        this.updateStatus('completed');
        this.emit('swarm:completed');
      }

      const result = this.buildResult(startTime);
      this.streamText(`\n✅ Swarm completed in ${Math.round(result.durationMs / 1000)}s\n`);

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.state.errors.push(errorMessage);
      this.updateStatus('failed');
      this.emit('swarm:failed', undefined, { error: errorMessage });

      this.streamText(`\n❌ Swarm failed: ${errorMessage}\n`);

      return {
        success: false,
        error: errorMessage,
        taskResults: this.getTaskResultsRecord(),
        metrics: this.state.metrics,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Stop swarm execution
   */
  stop(): void {
    this.stopped = true;
    if (this.state && this.isRunning()) {
      this.updateStatus('cancelled');
      this.emit('swarm:cancelled');
      this.streamText('\n🛑 Swarm cancelled\n');
    }
  }

  // ============================================
  // Planning Phase
  // ============================================

  private async runPlanner(goal: string, context?: string): Promise<SwarmPlan> {
    const prompt = this.buildPlannerPrompt(goal, context);

    const result = await this.spawnAgent({
      role: 'planner',
      task: prompt,
      tools: this.config.plannerTools,
    });

    if (!result.success || !result.result) {
      throw new Error(`Planner failed: ${result.error || 'No result'}`);
    }

    // Parse planner output into tasks
    const tasks = this.parsePlannerOutput(result.result);

    return {
      id: generateId(),
      goal,
      tasks,
      createdAt: Date.now(),
      approved: false,
      version: 1,
    };
  }

  private buildPlannerPrompt(goal: string, context?: string): string {
    let prompt = `Goal: ${goal}\n\n`;
    if (context) {
      prompt += `Context:\n${context}\n\n`;
    }
    prompt += `Create a plan to achieve this goal. Output a JSON array of tasks.
Each task should have:
- "description": Clear task description
- "dependsOn": Array of task indices this depends on (use 0-based indices)
- "priority": Number 1-5 (1 = highest)
- "requiredTools": Array of tool names needed

Maximum ${this.config.maxTasks} tasks.`;

    return prompt;
  }

  private parsePlannerOutput(output: string): SwarmTask[] {
    // Extract JSON from output
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // Fallback: create single task from output
      return [{
        id: generateId(),
        description: output.trim(),
        status: 'pending',
        role: 'worker',
        priority: 1,
        dependsOn: [],
        createdAt: Date.now(),
      }];
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        description: string;
        dependsOn?: number[];
        priority?: number;
        requiredTools?: string[];
      }>;

      // Create task IDs first
      const taskIds = parsed.map(() => generateId());

      return parsed.slice(0, this.config.maxTasks).map((item, index) => ({
        id: taskIds[index],
        description: item.description || `Task ${index + 1}`,
        status: 'pending' as SwarmTaskStatus,
        role: 'worker' as SwarmRole,
        priority: item.priority ?? 3,
        dependsOn: (item.dependsOn || []).map(i => taskIds[i]).filter(Boolean),
        createdAt: Date.now(),
        requiredTools: item.requiredTools,
      }));
    } catch {
      // JSON parse failed, create single task
      return [{
        id: generateId(),
        description: output.trim(),
        status: 'pending',
        role: 'worker',
        priority: 1,
        dependsOn: [],
        createdAt: Date.now(),
      }];
    }
  }

  private createPlanFromTasks(goal: string, tasks: SwarmInput['tasks']): SwarmPlan {
    const taskIds = (tasks || []).map(() => generateId());

    return {
      id: generateId(),
      goal,
      tasks: (tasks || []).map((t, index) => ({
        id: taskIds[index],
        description: t.description,
        status: 'pending' as SwarmTaskStatus,
        role: t.role || 'worker',
        priority: t.priority || 3,
        dependsOn: (t.dependsOn || []).map(i => taskIds[parseInt(i)] || i),
        createdAt: Date.now(),
        requiredTools: t.requiredTools,
      })),
      createdAt: Date.now(),
      approved: true,
      approvedAt: Date.now(),
      version: 1,
    };
  }

  // ============================================
  // Execution Phase
  // ============================================

  private async executeTaskGraph(plan: SwarmPlan): Promise<void> {
    const completed = new Set<string>();
    const failed = new Set<string>();
    const running = new Map<string, Promise<void>>();

    while (!this.stopped) {
      // Find ready tasks
      const readyTasks = plan.tasks.filter(task =>
        task.status === 'pending' &&
        task.dependsOn.every(dep => completed.has(dep))
      );

      // Update blocked tasks
      plan.tasks.forEach(task => {
        if (task.status === 'pending' &&
            task.dependsOn.some(dep => failed.has(dep))) {
          task.status = 'blocked';
        }
      });

      // Check if done
      const pendingCount = plan.tasks.filter(t =>
        t.status === 'pending' || t.status === 'running'
      ).length;

      if (pendingCount === 0 && running.size === 0) {
        break;
      }

      // Spawn tasks up to concurrency limit
      const availableSlots = this.config.maxConcurrent - running.size;
      const tasksToSpawn = readyTasks
        .sort((a, b) => a.priority - b.priority)
        .slice(0, availableSlots);

      for (const task of tasksToSpawn) {
        task.status = 'running';
        task.startedAt = Date.now();
        this.state!.metrics.runningTasks++;

        const promise = this.executeTask(task)
          .then(() => {
            task.status = 'completed';
            task.completedAt = Date.now();
            completed.add(task.id);
            this.state!.metrics.completedTasks++;
            this.state!.metrics.runningTasks--;
            this.emit('swarm:task_completed', task.id);
          })
          .catch((error) => {
            task.status = 'failed';
            task.completedAt = Date.now();
            failed.add(task.id);
            this.state!.metrics.failedTasks++;
            this.state!.metrics.runningTasks--;
            this.state!.errors.push(`Task ${task.id}: ${error.message || error}`);
            this.emit('swarm:task_failed', task.id, { error: error.message });
          })
          .finally(() => {
            running.delete(task.id);
          });

        running.set(task.id, promise);
        this.emit('swarm:task_started', task.id);
      }

      // Wait for at least one task to complete
      if (running.size > 0) {
        await Promise.race(Array.from(running.values()));
      } else if (readyTasks.length === 0 && pendingCount > 0) {
        // Deadlock - all remaining tasks are blocked
        break;
      }
    }
  }

  private async executeTask(task: SwarmTask): Promise<void> {
    // Build task prompt with context from dependencies
    const dependencyContext = this.buildDependencyContext(task);
    const taskPrompt = `${task.description}\n\n${dependencyContext}`;

    // Select tools
    const tools = task.requiredTools || this.config.workerTools;

    const result = await this.spawnAgent({
      role: task.role,
      task: taskPrompt,
      tools,
    });

    // Store result
    task.result = result;
    if (this.state) {
      this.state.taskResults.set(task.id, result);
    }

    // Update metrics
    if (this.state) {
      this.state.metrics.tokensUsed += 0; // TODO: Track from subagent
      this.state.metrics.toolCalls += result.toolCalls;
      this.state.metrics.llmCalls++;
    }

    if (!result.success) {
      throw new Error(result.error || 'Task failed');
    }
  }

  private buildDependencyContext(task: SwarmTask): string {
    if (task.dependsOn.length === 0) return '';

    const parts: string[] = ['Previous task results:'];

    for (const depId of task.dependsOn) {
      const result = this.state?.taskResults.get(depId);
      if (result?.result) {
        const depTask = this.state?.plan?.tasks.find(t => t.id === depId);
        parts.push(`\n[${depTask?.description || depId}]:\n${result.result}`);
      }
    }

    return parts.length > 1 ? parts.join('\n') : '';
  }

  // ============================================
  // Critic Phase
  // ============================================

  private async runCriticReview(): Promise<void> {
    const completedTasks = this.state?.plan?.tasks.filter(t => t.status === 'completed') || [];
    if (completedTasks.length === 0) return;

    const reviewPrompt = this.buildCriticPrompt(completedTasks);

    this.emit('swarm:review_started');
    this.streamText('\n🔍 Running critic review...\n');

    const result = await this.spawnAgent({
      role: 'critic',
      task: reviewPrompt,
      tools: this.config.criticTools,
    });

    if (result.success && result.result) {
      // Parse critic output
      try {
        const review = this.parseCriticOutput(result.result);
        if (!review.approved && review.issues.length > 0) {
          this.streamText(`\n⚠️ Critic found ${review.issues.length} issues:\n`);
          review.issues.forEach(issue => this.streamText(`  - ${issue}\n`));
        } else {
          this.streamText('\n✅ Critic approved the work\n');
        }
      } catch {
        // Couldn't parse, log the raw result
        this.streamText(`\nCritic review: ${result.result}\n`);
      }
    }

    this.emit('swarm:review_completed');
  }

  private buildCriticPrompt(tasks: SwarmTask[]): string {
    const taskSummaries = tasks.map(task => {
      const result = this.state?.taskResults.get(task.id);
      return `Task: ${task.description}\nResult: ${result?.result || 'No result'}`;
    }).join('\n\n---\n\n');

    return `Review the following completed work:\n\n${taskSummaries}\n\nProvide your assessment as JSON with "approved", "issues", and "suggestions" fields.`;
  }

  private parseCriticOutput(output: string): { approved: boolean; issues: string[]; suggestions: string[] } {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        approved: parsed.approved ?? true,
        issues: parsed.issues || [],
        suggestions: parsed.suggestions || [],
      };
    }
    return { approved: true, issues: [], suggestions: [] };
  }

  // ============================================
  // Aggregation Phase
  // ============================================

  private async runAggregator(goal: string): Promise<string> {
    const completedTasks = this.state?.plan?.tasks.filter(t => t.status === 'completed') || [];
    if (completedTasks.length === 0) {
      return 'No tasks completed';
    }

    const aggregatePrompt = this.buildAggregatorPrompt(goal, completedTasks);

    const result = await this.spawnAgent({
      role: 'aggregator',
      task: aggregatePrompt,
      tools: [], // Aggregator typically doesn't need tools
    });

    return result.result || 'Failed to aggregate results';
  }

  private buildAggregatorPrompt(goal: string, tasks: SwarmTask[]): string {
    const taskSummaries = tasks.map(task => {
      const result = this.state?.taskResults.get(task.id);
      return `[${task.description}]\n${result?.result || 'No result'}`;
    }).join('\n\n---\n\n');

    return `Original goal: ${goal}\n\nCompleted task results:\n\n${taskSummaries}\n\nSynthesize these results into a comprehensive final answer.`;
  }

  // ============================================
  // Agent Spawning
  // ============================================

  private async spawnAgent(params: {
    role: SwarmRole;
    task: string;
    tools: string[];
  }): Promise<SubagentResult> {
    const { role, task, tools } = params;

    // Build system prompt
    const systemPrompt = ROLE_SYSTEM_PROMPTS[role];
    const fullTask = `${systemPrompt}\n\n---\n\n${task}`;

    // Filter forbidden tools
    const filteredTools = tools.filter(t =>
      !this.config.forbiddenTools.includes(t)
    );

    // Check if we should use registry for agent selection
    if (this.context.registry && role === 'worker') {
      const bestMatch = this.context.registry.findBestMatch({
        required: { tools: filteredTools },
        maxLoadFactor: 0.9,
      });

      if (bestMatch) {
        // TODO: Delegate to matched agent instead of spawning new one
        // This will be implemented in task #1069 (Swarm agent selection via registry)
      }
    }

    const config: SubagentConfig = {
      task: fullTask,
      tools: filteredTools,
      maxTurns: 15,
      parentSessionId: this.context.sessionId,
      depth: this.context.depth + 1,
      cwd: this.context.cwd,
    };

    return this.context.subagentManager.spawn(config);
  }

  // ============================================
  // Helpers
  // ============================================

  private updateStatus(status: SwarmStatus): void {
    if (this.state) {
      this.state.status = status;
    }
  }

  private createEmptyMetrics(): SwarmMetrics {
    return {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      runningTasks: 0,
      tokensUsed: 0,
      llmCalls: 0,
      toolCalls: 0,
      replans: 0,
    };
  }

  private getTaskResultsRecord(): Record<string, SubagentResult> {
    const record: Record<string, SubagentResult> = {};
    if (this.state) {
      for (const [id, result] of this.state.taskResults) {
        record[id] = result;
      }
    }
    return record;
  }

  private buildResult(startTime: number): SwarmResult {
    const success = this.state?.status === 'completed' &&
                   this.state.metrics.failedTasks === 0;

    return {
      success,
      result: this.state?.finalResult,
      error: success ? undefined : this.state?.errors.join('; '),
      taskResults: this.getTaskResultsRecord(),
      metrics: this.state?.metrics || this.createEmptyMetrics(),
      durationMs: Date.now() - startTime,
    };
  }
}

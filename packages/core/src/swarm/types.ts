/**
 * Swarm Types
 *
 * Defines the data model for swarm coordination.
 * Swarm is a multi-agent orchestration pattern that distributes work
 * across specialized subagents (planner, worker, critic).
 */

import type { SubagentResult } from '../agent/subagent-manager';

/**
 * Role type for specialized swarm agents
 */
export type SwarmRole = 'planner' | 'worker' | 'critic' | 'aggregator';

/**
 * Status of a swarm task
 */
export type SwarmTaskStatus =
  | 'pending'       // Not yet started
  | 'assigned'      // Assigned to an agent
  | 'running'       // Currently executing
  | 'completed'     // Successfully completed
  | 'failed'        // Failed with error
  | 'blocked'       // Blocked by dependencies
  | 'cancelled';    // Cancelled by coordinator

/**
 * A single task within the swarm task graph
 */
export interface SwarmTask {
  /** Unique task identifier */
  id: string;
  /** Task description/instruction */
  description: string;
  /** Current status */
  status: SwarmTaskStatus;
  /** Role required for this task */
  role: SwarmRole;
  /** Priority (1 = highest) */
  priority: number;
  /** IDs of tasks this depends on */
  dependsOn: string[];
  /** ID of agent assigned to this task */
  assignedAgentId?: string;
  /** Time when task was created */
  createdAt: number;
  /** Time when task was started */
  startedAt?: number;
  /** Time when task was completed */
  completedAt?: number;
  /** Result from subagent */
  result?: SubagentResult;
  /** Input data for the task */
  input?: unknown;
  /** Output data from the task */
  output?: unknown;
  /** Required tools for this task */
  requiredTools?: string[];
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Overall swarm execution status
 */
export type SwarmStatus =
  | 'idle'          // Not running
  | 'planning'      // Planner creating task graph
  | 'executing'     // Workers processing tasks
  | 'reviewing'     // Critic reviewing results
  | 'aggregating'   // Aggregating final results
  | 'completed'     // Successfully completed
  | 'failed'        // Failed with errors
  | 'cancelled';    // Cancelled by user

/**
 * Swarm execution plan
 */
export interface SwarmPlan {
  /** Plan ID */
  id: string;
  /** Original goal/instruction */
  goal: string;
  /** All tasks in the plan */
  tasks: SwarmTask[];
  /** Plan creation timestamp */
  createdAt: number;
  /** Whether plan was approved by user */
  approved: boolean;
  /** Approval timestamp */
  approvedAt?: number;
  /** Plan version (for replanning) */
  version: number;
}

/**
 * Swarm execution state
 */
export interface SwarmState {
  /** Swarm execution ID */
  id: string;
  /** Current status */
  status: SwarmStatus;
  /** Current execution plan */
  plan: SwarmPlan | null;
  /** Parent session ID */
  sessionId: string;
  /** Results from completed tasks */
  taskResults: Map<string, SubagentResult>;
  /** Active agent IDs */
  activeAgents: Set<string>;
  /** Error messages */
  errors: string[];
  /** Start timestamp */
  startedAt: number;
  /** End timestamp */
  endedAt?: number;
  /** Final aggregated result */
  finalResult?: string;
  /** Progress metrics */
  metrics: SwarmMetrics;
}

/**
 * Swarm execution metrics
 */
export interface SwarmMetrics {
  /** Total tasks in plan */
  totalTasks: number;
  /** Completed tasks */
  completedTasks: number;
  /** Failed tasks */
  failedTasks: number;
  /** Tasks currently running */
  runningTasks: number;
  /** Total tokens used across all agents */
  tokensUsed: number;
  /** Total LLM calls */
  llmCalls: number;
  /** Total tool calls */
  toolCalls: number;
  /** Number of replans */
  replans: number;
}

/**
 * Configuration for swarm coordinator
 */
export interface SwarmConfig {
  /** Enable swarm mode (default: true) */
  enabled: boolean;
  /** Maximum concurrent worker agents (default: 3) */
  maxConcurrent: number;
  /** Maximum tasks per swarm (default: 20) */
  maxTasks: number;
  /** Maximum depth for subagents (default: 2) */
  maxDepth: number;
  /** Timeout per task in ms (default: 120000) */
  taskTimeoutMs: number;
  /** Overall swarm timeout in ms (default: 600000 = 10min) */
  swarmTimeoutMs: number;
  /** Auto-approve plans (skip user confirmation) */
  autoApprove: boolean;
  /** Enable critic review pass */
  enableCritic: boolean;
  /** Maximum critic iterations (default: 2) */
  maxCriticIterations: number;
  /** Default tools for planner */
  plannerTools: string[];
  /** Default tools for workers */
  workerTools: string[];
  /** Default tools for critic */
  criticTools: string[];
  /** Tools forbidden from all swarm agents */
  forbiddenTools: string[];
  /** Token budget for entire swarm (0 = no limit) */
  tokenBudget: number;
  /** Enable shared memory between agents */
  enableSharedMemory: boolean;
}

/**
 * Default swarm configuration
 */
export const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  enabled: true,
  maxConcurrent: 3,
  maxTasks: 20,
  maxDepth: 2,
  taskTimeoutMs: 120_000,
  swarmTimeoutMs: 600_000,
  autoApprove: false,
  enableCritic: true,
  maxCriticIterations: 2,
  plannerTools: ['read', 'glob', 'grep', 'web_search', 'web_fetch'],
  workerTools: ['read', 'glob', 'grep', 'bash', 'edit', 'write'],
  criticTools: ['read', 'glob', 'grep'],
  forbiddenTools: ['agent_spawn', 'wallet_get', 'secrets_get', 'schedule_create'],
  tokenBudget: 0,
  enableSharedMemory: false,
};

/**
 * Swarm event types
 */
export type SwarmEventType =
  | 'swarm:started'
  | 'swarm:plan_created'
  | 'swarm:plan_approved'
  | 'swarm:task_started'
  | 'swarm:task_completed'
  | 'swarm:task_failed'
  | 'swarm:review_started'
  | 'swarm:review_completed'
  | 'swarm:completed'
  | 'swarm:failed'
  | 'swarm:cancelled';

/**
 * Swarm event payload
 */
export interface SwarmEvent {
  type: SwarmEventType;
  swarmId: string;
  taskId?: string;
  timestamp: number;
  data?: unknown;
}

/**
 * Swarm event listener
 */
export type SwarmEventListener = (event: SwarmEvent) => void;

/**
 * Result from swarm execution
 */
export interface SwarmResult {
  /** Whether swarm completed successfully */
  success: boolean;
  /** Final aggregated result */
  result?: string;
  /** Error message if failed */
  error?: string;
  /** All task results */
  taskResults: Record<string, SubagentResult>;
  /** Execution metrics */
  metrics: SwarmMetrics;
  /** Execution time in ms */
  durationMs: number;
}

/**
 * Input for starting a swarm
 */
export interface SwarmInput {
  /** The goal/instruction for the swarm */
  goal: string;
  /** Additional context */
  context?: string;
  /** Pre-defined tasks (skip planning phase) */
  tasks?: Array<{
    description: string;
    role?: SwarmRole;
    priority?: number;
    dependsOn?: string[];
    requiredTools?: string[];
  }>;
  /** Override config for this execution */
  config?: Partial<SwarmConfig>;
}

/**
 * Role-specific system prompts
 */
export const ROLE_SYSTEM_PROMPTS: Record<SwarmRole, string> = {
  planner: `You are a planning agent responsible for breaking down complex goals into smaller tasks.
When given a goal, create a detailed task list with:
1. Clear, actionable task descriptions
2. Appropriate dependencies between tasks
3. Priority assignments (1 = highest)
4. Required tools for each task

Output your plan as a JSON array of tasks:
[{"description": "...", "dependsOn": [], "priority": 1, "requiredTools": ["read", "grep"]}]`,

  worker: `You are a worker agent responsible for completing assigned tasks.
Focus on:
1. Completing the specific task assigned to you
2. Using only the tools provided
3. Returning clear, structured results
4. Reporting any blockers or issues

Be thorough but efficient. Return your result in a clear format.`,

  critic: `You are a critic agent responsible for reviewing work quality.
Evaluate:
1. Completeness: Did the work fully address the requirement?
2. Quality: Is the work well-structured and correct?
3. Issues: Are there any problems or improvements needed?

Output your review as JSON:
{"approved": true/false, "issues": ["issue1", "issue2"], "suggestions": ["suggestion1"]}`,

  aggregator: `You are an aggregator agent responsible for combining results.
Your task:
1. Review all completed task results
2. Synthesize them into a coherent final output
3. Ensure nothing important is missed
4. Present the result clearly

Combine the results into a comprehensive final answer.`,
};

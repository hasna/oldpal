/**
 * Swarm Agent Selector
 *
 * Selects agents for swarm tasks based on capability, heartbeat status,
 * tool scopes, and load. Produces assignment plans with fallback handling.
 */

import type { AgentRegistryService, RegisteredAgent } from '../registry';
import type { SwarmTask, SwarmRole } from './types';

/**
 * Agent assignment for a task
 */
export interface TaskAgentAssignment {
  /** Task ID */
  taskId: string;
  /** Assigned agent ID (null if using fallback) */
  agentId: string | null;
  /** Assigned agent (null if using fallback) */
  agent: RegisteredAgent | null;
  /** Whether this is a fallback assignment */
  isFallback: boolean;
  /** Fallback reason if applicable */
  fallbackReason?: string;
  /** Match score (0-1) */
  matchScore: number;
  /** Requirements used for matching */
  requirements: AgentRequirements;
}

/**
 * Agent requirements for matching
 */
export interface AgentRequirements {
  /** Required tools */
  requiredTools?: string[];
  /** Preferred tools */
  preferredTools?: string[];
  /** Required skills */
  requiredSkills?: string[];
  /** Required tags */
  requiredTags?: string[];
  /** Role preference */
  rolePreference?: SwarmRole;
  /** Maximum acceptable load factor */
  maxLoadFactor?: number;
}

/**
 * Assignment plan for a swarm
 */
export interface AssignmentPlan {
  /** Task assignments */
  assignments: Map<string, TaskAgentAssignment>;
  /** Unassigned task IDs (need fallback) */
  unassignedTasks: string[];
  /** Statistics */
  stats: AssignmentStats;
  /** Warnings */
  warnings: string[];
  /** Timestamp */
  createdAt: number;
}

/**
 * Assignment statistics
 */
export interface AssignmentStats {
  /** Total tasks */
  totalTasks: number;
  /** Assigned tasks */
  assignedTasks: number;
  /** Fallback tasks */
  fallbackTasks: number;
  /** Unique agents used */
  uniqueAgents: number;
  /** Average match score */
  averageMatchScore: number;
  /** Distribution by agent */
  tasksByAgent: Map<string, number>;
}

/**
 * Selector configuration
 */
export interface AgentSelectorConfig {
  /** Enable registry-based selection */
  enabled: boolean;
  /** Maximum load factor for agent selection */
  maxLoadFactor: number;
  /** Minimum match score to accept */
  minMatchScore: number;
  /** Prefer agents with matching skills */
  preferSkillMatch: boolean;
  /** Prefer agents with lower load */
  preferLowLoad: boolean;
  /** Enable load balancing across agents */
  enableLoadBalancing: boolean;
  /** Maximum tasks per agent */
  maxTasksPerAgent: number;
  /** Role-based tool preferences */
  roleToolPreferences: Record<SwarmRole, string[]>;
}

/**
 * Default selector configuration
 */
export const DEFAULT_SELECTOR_CONFIG: AgentSelectorConfig = {
  enabled: true,
  maxLoadFactor: 0.9,
  minMatchScore: 0.3,
  preferSkillMatch: true,
  preferLowLoad: true,
  enableLoadBalancing: true,
  maxTasksPerAgent: 5,
  roleToolPreferences: {
    planner: ['tasks_create', 'tasks_list', 'plan_create'],
    worker: ['bash', 'read', 'write', 'edit', 'glob', 'grep'],
    critic: ['read', 'grep', 'tasks_list'],
    aggregator: ['tasks_list', 'read'],
  },
};

/**
 * Swarm Agent Selector
 *
 * Selects agents for swarm tasks based on capabilities and availability.
 */
export class SwarmAgentSelector {
  private config: AgentSelectorConfig;
  private registry: AgentRegistryService | null;

  constructor(
    registry?: AgentRegistryService,
    config?: Partial<AgentSelectorConfig>
  ) {
    this.registry = registry || null;
    this.config = { ...DEFAULT_SELECTOR_CONFIG, ...config };
  }

  /**
   * Check if registry-based selection is available
   */
  isEnabled(): boolean {
    return this.config.enabled && this.registry !== null;
  }

  /**
   * Create assignment plan for a list of tasks
   */
  createAssignmentPlan(tasks: SwarmTask[]): AssignmentPlan {
    const assignments = new Map<string, TaskAgentAssignment>();
    const warnings: string[] = [];
    const tasksByAgent = new Map<string, number>();
    let totalMatchScore = 0;
    let fallbackCount = 0;

    // Process tasks in priority order
    const sortedTasks = [...tasks].sort((a, b) => a.priority - b.priority);

    for (const task of sortedTasks) {
      const requirements = this.buildRequirements(task);
      const assignment = this.selectAgentForTask(task, requirements, tasksByAgent);

      assignments.set(task.id, assignment);
      totalMatchScore += assignment.matchScore;

      if (assignment.isFallback) {
        fallbackCount++;
        if (assignment.fallbackReason) {
          warnings.push(`Task ${task.id}: ${assignment.fallbackReason}`);
        }
      } else if (assignment.agentId) {
        const count = tasksByAgent.get(assignment.agentId) || 0;
        tasksByAgent.set(assignment.agentId, count + 1);
      }
    }

    // Identify unassigned tasks
    const unassignedTasks = Array.from(assignments.entries())
      .filter(([_, a]) => a.isFallback)
      .map(([id]) => id);

    // Build stats
    const stats: AssignmentStats = {
      totalTasks: tasks.length,
      assignedTasks: tasks.length - fallbackCount,
      fallbackTasks: fallbackCount,
      uniqueAgents: tasksByAgent.size,
      averageMatchScore: tasks.length > 0 ? totalMatchScore / tasks.length : 0,
      tasksByAgent,
    };

    return {
      assignments,
      unassignedTasks,
      stats,
      warnings,
      createdAt: Date.now(),
    };
  }

  /**
   * Select single best agent for a task
   */
  selectAgentForTask(
    task: SwarmTask,
    requirements: AgentRequirements,
    currentAssignments?: Map<string, number>
  ): TaskAgentAssignment {
    // If registry not available, use fallback
    if (!this.registry || !this.config.enabled) {
      return this.createFallbackAssignment(task, requirements, 'Registry not available');
    }

    // Build match criteria
    const matchCriteria = this.buildMatchCriteria(requirements, currentAssignments);

    // Find best match
    const bestAgent = this.registry.findBestMatch(matchCriteria);

    if (!bestAgent) {
      return this.createFallbackAssignment(task, requirements, 'No matching agents available');
    }

    // Calculate match score
    const matchScore = this.calculateMatchScore(bestAgent, requirements);

    // Check if match score meets minimum threshold
    if (matchScore < this.config.minMatchScore) {
      return this.createFallbackAssignment(
        task,
        requirements,
        `Match score ${matchScore.toFixed(2)} below threshold ${this.config.minMatchScore}`
      );
    }

    // Check load balancing constraints
    if (this.config.enableLoadBalancing && currentAssignments) {
      const currentLoad = currentAssignments.get(bestAgent.id) || 0;
      if (currentLoad >= this.config.maxTasksPerAgent) {
        // Try to find alternative agent
        const alternativeAgent = this.findAlternativeAgent(
          bestAgent.id,
          requirements,
          currentAssignments
        );

        if (alternativeAgent) {
          return {
            taskId: task.id,
            agentId: alternativeAgent.id,
            agent: alternativeAgent,
            isFallback: false,
            matchScore: this.calculateMatchScore(alternativeAgent, requirements),
            requirements,
          };
        }
      }
    }

    return {
      taskId: task.id,
      agentId: bestAgent.id,
      agent: bestAgent,
      isFallback: false,
      matchScore,
      requirements,
    };
  }

  /**
   * Find agents by capability
   */
  findAgentsByCapability(requirements: AgentRequirements): RegisteredAgent[] {
    if (!this.registry) {
      return [];
    }

    return this.registry.findByCapability({
      tools: requirements.requiredTools,
      skills: requirements.requiredSkills,
      tags: requirements.requiredTags,
    });
  }

  /**
   * Find available agents (idle, low load)
   */
  findAvailableAgents(options?: {
    maxLoadFactor?: number;
    limit?: number;
  }): RegisteredAgent[] {
    if (!this.registry) {
      return [];
    }

    return this.registry.findAvailable({
      maxLoadFactor: options?.maxLoadFactor ?? this.config.maxLoadFactor,
      limit: options?.limit,
    });
  }

  /**
   * Get agent by ID
   */
  getAgent(id: string): RegisteredAgent | null {
    return this.registry?.get(id) || null;
  }

  /**
   * Rebalance assignments to distribute load more evenly
   */
  rebalanceAssignments(plan: AssignmentPlan): AssignmentPlan {
    if (!this.config.enableLoadBalancing || plan.stats.uniqueAgents <= 1) {
      return plan;
    }

    const newAssignments = new Map(plan.assignments);
    const newTasksByAgent = new Map(plan.stats.tasksByAgent);
    const warnings = [...plan.warnings];

    // Find overloaded agents
    const avgTasksPerAgent = plan.stats.assignedTasks / Math.max(plan.stats.uniqueAgents, 1);
    const overloadThreshold = Math.ceil(avgTasksPerAgent * 1.5);

    for (const [agentId, taskCount] of newTasksByAgent) {
      if (taskCount <= overloadThreshold) continue;

      // Find tasks to reassign
      const agentTasks = Array.from(newAssignments.entries())
        .filter(([_, a]) => a.agentId === agentId && !a.isFallback);

      // Try to reassign excess tasks
      const excessCount = taskCount - overloadThreshold;
      let reassigned = 0;

      for (const [taskId, assignment] of agentTasks.slice(0, excessCount)) {
        const alternativeAgent = this.findAlternativeAgent(
          agentId,
          assignment.requirements,
          newTasksByAgent
        );

        if (alternativeAgent) {
          const newMatchScore = this.calculateMatchScore(alternativeAgent, assignment.requirements);

          newAssignments.set(taskId, {
            ...assignment,
            agentId: alternativeAgent.id,
            agent: alternativeAgent,
            matchScore: newMatchScore,
          });

          // Update counts
          newTasksByAgent.set(agentId, (newTasksByAgent.get(agentId) || 1) - 1);
          newTasksByAgent.set(
            alternativeAgent.id,
            (newTasksByAgent.get(alternativeAgent.id) || 0) + 1
          );

          reassigned++;
        }
      }

      if (reassigned > 0) {
        warnings.push(`Rebalanced ${reassigned} tasks from agent ${agentId}`);
      }
    }

    // Recalculate average match score
    let totalMatchScore = 0;
    for (const assignment of newAssignments.values()) {
      totalMatchScore += assignment.matchScore;
    }

    return {
      assignments: newAssignments,
      unassignedTasks: plan.unassignedTasks,
      stats: {
        ...plan.stats,
        averageMatchScore: newAssignments.size > 0
          ? totalMatchScore / newAssignments.size
          : 0,
        tasksByAgent: newTasksByAgent,
      },
      warnings,
      createdAt: Date.now(),
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Build requirements from task
   */
  private buildRequirements(task: SwarmTask): AgentRequirements {
    const roleTools = this.config.roleToolPreferences[task.role] || [];

    return {
      requiredTools: task.requiredTools || [],
      preferredTools: roleTools,
      rolePreference: task.role,
      maxLoadFactor: this.config.maxLoadFactor,
    };
  }

  /**
   * Build match criteria for registry query
   */
  private buildMatchCriteria(
    requirements: AgentRequirements,
    currentAssignments?: Map<string, number>
  ): Parameters<AgentRegistryService['findBestMatch']>[0] {
    // Adjust max load factor based on current assignments
    let adjustedMaxLoadFactor = requirements.maxLoadFactor ?? this.config.maxLoadFactor;

    if (this.config.enableLoadBalancing && currentAssignments && currentAssignments.size > 0) {
      // Slightly reduce acceptable load factor if agents are already assigned
      const totalAssignments = Array.from(currentAssignments.values())
        .reduce((sum, count) => sum + count, 0);
      if (totalAssignments > 5) {
        adjustedMaxLoadFactor = Math.max(0.5, adjustedMaxLoadFactor - 0.1);
      }
    }

    return {
      required: {
        tools: requirements.requiredTools,
        skills: requirements.requiredSkills,
        tags: requirements.requiredTags,
      },
      preferred: {
        tools: requirements.preferredTools,
      },
      maxLoadFactor: adjustedMaxLoadFactor,
    };
  }

  /**
   * Calculate match score for an agent
   */
  private calculateMatchScore(agent: RegisteredAgent, requirements: AgentRequirements): number {
    let score = 0;
    let totalWeight = 0;

    // Tool match (weight: 0.4)
    if (requirements.requiredTools && requirements.requiredTools.length > 0) {
      const agentTools = agent.capabilities.tools || [];
      const matchedTools = requirements.requiredTools.filter(t => agentTools.includes(t));
      const toolScore = matchedTools.length / requirements.requiredTools.length;
      score += toolScore * 0.4;
      totalWeight += 0.4;
    }

    // Skill match (weight: 0.2)
    if (requirements.requiredSkills && requirements.requiredSkills.length > 0) {
      const agentSkills = agent.capabilities.skills || [];
      const matchedSkills = requirements.requiredSkills.filter(s => agentSkills.includes(s));
      const skillScore = matchedSkills.length / requirements.requiredSkills.length;
      score += skillScore * 0.2;
      totalWeight += 0.2;
    }

    // Load factor (weight: 0.2) - prefer lower load
    // Calculate load factor from available properties
    const loadFactor = this.calculateLoadFactor(agent.load);
    const loadScore = 1 - loadFactor;
    score += loadScore * 0.2;
    totalWeight += 0.2;

    // Health (weight: 0.2) - prefer healthy agents
    const isHealthy = !agent.heartbeat.isStale && agent.status.state !== 'error';
    score += (isHealthy ? 1 : 0) * 0.2;
    totalWeight += 0.2;

    // Normalize
    return totalWeight > 0 ? score / totalWeight : 0;
  }

  /**
   * Calculate load factor (0-1) from agent load info
   */
  private calculateLoadFactor(load: RegisteredAgent['load']): number {
    // Calculate based on active/queued tasks and token usage
    const taskLoad = Math.min((load.activeTasks + load.queuedTasks * 0.5) / 5, 1);

    // Token load (if limit is set)
    const tokenLoad = load.tokenLimit
      ? Math.min(load.tokensUsed / load.tokenLimit, 1)
      : 0;

    // LLM call load (if limit is set)
    const llmLoad = load.llmCallLimit
      ? Math.min(load.llmCalls / load.llmCallLimit, 1)
      : 0;

    // Combine with weights: task load is most important
    return taskLoad * 0.6 + tokenLoad * 0.25 + llmLoad * 0.15;
  }

  /**
   * Find alternative agent excluding specified agent
   */
  private findAlternativeAgent(
    excludeAgentId: string,
    requirements: AgentRequirements,
    currentAssignments: Map<string, number>
  ): RegisteredAgent | null {
    if (!this.registry) return null;

    // Find all available agents
    const availableAgents = this.findAvailableAgents({
      maxLoadFactor: requirements.maxLoadFactor,
    });

    // Filter out excluded agent and overloaded agents
    const candidates = availableAgents.filter(agent => {
      if (agent.id === excludeAgentId) return false;

      const currentLoad = currentAssignments.get(agent.id) || 0;
      return currentLoad < this.config.maxTasksPerAgent;
    });

    if (candidates.length === 0) return null;

    // Score and sort candidates
    const scoredCandidates = candidates.map(agent => ({
      agent,
      score: this.calculateMatchScore(agent, requirements),
    }));

    scoredCandidates.sort((a, b) => b.score - a.score);

    // Return best candidate above threshold
    const best = scoredCandidates[0];
    return best && best.score >= this.config.minMatchScore ? best.agent : null;
  }

  /**
   * Create fallback assignment
   */
  private createFallbackAssignment(
    task: SwarmTask,
    requirements: AgentRequirements,
    reason: string
  ): TaskAgentAssignment {
    return {
      taskId: task.id,
      agentId: null,
      agent: null,
      isFallback: true,
      fallbackReason: reason,
      matchScore: 0,
      requirements,
    };
  }
}

/**
 * Create a selector with default configuration
 */
export function createSwarmAgentSelector(
  registry?: AgentRegistryService,
  config?: Partial<AgentSelectorConfig>
): SwarmAgentSelector {
  return new SwarmAgentSelector(registry, config);
}

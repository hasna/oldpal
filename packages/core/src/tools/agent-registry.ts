/**
 * Agent Registry Tools
 *
 * Tools for querying and interacting with the agent registry.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolRegistry } from './registry';
import type { AgentRegistryService, RegisteredAgent, AgentQuery, RegistryAgentState, AgentType } from '../registry';

/**
 * Context required for registry tools
 */
export interface RegistryToolContext {
  /** Registry service instance */
  getRegistryService?: () => AgentRegistryService | null;
  /** Current session ID (for filtering) */
  sessionId?: string;
  /** Current agent ID */
  agentId?: string;
}

/**
 * Format agent for display
 */
function formatAgent(agent: RegisteredAgent): string {
  const lines: string[] = [];

  lines.push(`ID: ${agent.id}`);
  lines.push(`Name: ${agent.name}`);
  lines.push(`Type: ${agent.type}`);
  lines.push(`State: ${agent.status.state}`);

  if (agent.description) {
    lines.push(`Description: ${agent.description}`);
  }

  if (agent.sessionId) {
    lines.push(`Session: ${agent.sessionId}`);
  }

  if (agent.parentId) {
    lines.push(`Parent: ${agent.parentId}`);
  }

  if (agent.childIds.length > 0) {
    lines.push(`Children: ${agent.childIds.join(', ')}`);
  }

  // Capabilities
  const caps: string[] = [];
  if (agent.capabilities.tools.length > 0) {
    caps.push(`tools: ${agent.capabilities.tools.slice(0, 5).join(', ')}${agent.capabilities.tools.length > 5 ? '...' : ''}`);
  }
  if (agent.capabilities.skills.length > 0) {
    caps.push(`skills: ${agent.capabilities.skills.slice(0, 3).join(', ')}${agent.capabilities.skills.length > 3 ? '...' : ''}`);
  }
  if (agent.capabilities.tags.length > 0) {
    caps.push(`tags: ${agent.capabilities.tags.join(', ')}`);
  }
  if (caps.length > 0) {
    lines.push(`Capabilities: ${caps.join('; ')}`);
  }

  // Load
  lines.push(`Load: ${agent.load.activeTasks} active, ${agent.load.queuedTasks} queued`);

  // Heartbeat
  const staleStatus = agent.heartbeat.isStale ? ' (STALE)' : '';
  lines.push(`Last Heartbeat: ${agent.heartbeat.lastHeartbeat}${staleStatus}`);

  return lines.join('\n');
}

/**
 * Registry list tool - list all registered agents
 */
export const registryListTool: Tool = {
  name: 'registry_list',
  description: 'List all registered agents in the system. Returns agent IDs, names, types, and status.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['assistant', 'subagent', 'coordinator', 'worker'],
        description: 'Filter by agent type',
      },
      state: {
        type: 'string',
        enum: ['idle', 'processing', 'waiting_input', 'error', 'offline', 'stopped'],
        description: 'Filter by agent state',
      },
      sessionId: {
        type: 'string',
        description: 'Filter by session ID',
      },
      includeOffline: {
        type: 'boolean',
        description: 'Include offline/stale agents (default: false)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of agents to return (default: 20)',
      },
    },
  },
};

/**
 * Create registry_list executor
 */
export function createRegistryListExecutor(context: RegistryToolContext) {
  return async (input: {
    type?: AgentType;
    state?: RegistryAgentState;
    sessionId?: string;
    includeOffline?: boolean;
    limit?: number;
  }): Promise<string> => {
    const service = context.getRegistryService?.();
    if (!service) {
      return 'Registry service not available';
    }

    try {
      const query: AgentQuery = {
        type: input.type,
        state: input.state,
        sessionId: input.sessionId,
        includeOffline: input.includeOffline ?? false,
        limit: Math.min(input.limit ?? 20, 100),
        sortBy: 'registeredAt',
        sortDir: 'desc',
      };

      const result = service.query(query);

      if (result.agents.length === 0) {
        return 'No agents found matching the criteria.';
      }

      const lines: string[] = [];
      lines.push(`Found ${result.total} agent(s)${result.total > result.agents.length ? ` (showing ${result.agents.length})` : ''}:\n`);

      for (const agent of result.agents) {
        lines.push(`---`);
        lines.push(formatAgent(agent));
      }

      return lines.join('\n');
    } catch (error) {
      return `Failed to list agents: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * Registry query tool - query agents by capability
 */
export const registryQueryTool: Tool = {
  name: 'registry_query',
  description: 'Query agents by capabilities, finding agents that have specific tools, skills, or tags.',
  parameters: {
    type: 'object',
    properties: {
      requiredTools: {
        type: 'array',
        items: { type: 'string', description: 'Tool name' },
        description: 'Required tools the agent must have',
      },
      requiredSkills: {
        type: 'array',
        items: { type: 'string', description: 'Skill name' },
        description: 'Required skills the agent must have',
      },
      requiredTags: {
        type: 'array',
        items: { type: 'string', description: 'Tag name' },
        description: 'Required tags the agent must have',
      },
      preferredTools: {
        type: 'array',
        items: { type: 'string', description: 'Tool name' },
        description: 'Preferred tools (improves match score)',
      },
      preferredTags: {
        type: 'array',
        items: { type: 'string', description: 'Tag name' },
        description: 'Preferred tags (improves match score)',
      },
      maxLoadFactor: {
        type: 'number',
        description: 'Maximum load factor (0-1, default: 0.8)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of agents to return (default: 10)',
      },
    },
  },
};

/**
 * Create registry_query executor
 */
export function createRegistryQueryExecutor(context: RegistryToolContext) {
  return async (input: {
    requiredTools?: string[];
    requiredSkills?: string[];
    requiredTags?: string[];
    preferredTools?: string[];
    preferredTags?: string[];
    maxLoadFactor?: number;
    limit?: number;
  }): Promise<string> => {
    const service = context.getRegistryService?.();
    if (!service) {
      return 'Registry service not available';
    }

    try {
      const query: AgentQuery = {
        requiredCapabilities: {
          tools: input.requiredTools,
          skills: input.requiredSkills,
          tags: input.requiredTags,
        },
        preferredCapabilities: {
          tools: input.preferredTools,
          tags: input.preferredTags,
        },
        maxLoadFactor: input.maxLoadFactor ?? 0.8,
        limit: Math.min(input.limit ?? 10, 50),
        includeOffline: false,
      };

      const result = service.query(query);

      if (result.agents.length === 0) {
        return 'No agents found matching the capability requirements.';
      }

      const lines: string[] = [];
      lines.push(`Found ${result.total} matching agent(s)${result.total > result.agents.length ? ` (showing ${result.agents.length})` : ''}:\n`);

      for (const agent of result.agents) {
        const score = result.scores.get(agent.id) ?? 0;
        lines.push(`---`);
        lines.push(`Match Score: ${(score * 100).toFixed(0)}%`);
        lines.push(formatAgent(agent));
      }

      return lines.join('\n');
    } catch (error) {
      return `Failed to query agents: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * Registry get tool - get details of a specific agent
 */
export const registryGetTool: Tool = {
  name: 'registry_get',
  description: 'Get detailed information about a specific registered agent by ID.',
  parameters: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'The agent ID to look up',
      },
    },
    required: ['agentId'],
  },
};

/**
 * Create registry_get executor
 */
export function createRegistryGetExecutor(context: RegistryToolContext) {
  return async (input: Record<string, unknown>): Promise<string> => {
    const service = context.getRegistryService?.();
    if (!service) {
      return 'Registry service not available';
    }

    const agentId = input.agentId as string;
    if (!agentId) {
      return 'Agent ID is required';
    }

    try {
      const agent = service.get(agentId);

      if (!agent) {
        return `Agent not found: ${agentId}`;
      }

      return formatAgent(agent);
    } catch (error) {
      return `Failed to get agent: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * Registry stats tool - get registry statistics
 */
export const registryStatsTool: Tool = {
  name: 'registry_stats',
  description: 'Get statistics about the agent registry, including counts by type and state.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Create registry_stats executor
 */
export function createRegistryStatsExecutor(context: RegistryToolContext) {
  return async (): Promise<string> => {
    const service = context.getRegistryService?.();
    if (!service) {
      return 'Registry service not available';
    }

    try {
      const stats = service.getStats();

      const lines: string[] = [];
      lines.push('Registry Statistics:');
      lines.push(`  Total Agents: ${stats.totalAgents}`);
      lines.push(`  Stale Count: ${stats.staleCount}`);
      lines.push(`  Average Load: ${(stats.averageLoad * 100).toFixed(1)}%`);
      lines.push(`  Uptime: ${Math.floor(stats.uptime)}s`);

      lines.push('\nBy Type:');
      for (const [type, count] of Object.entries(stats.byType)) {
        if (count > 0) {
          lines.push(`  ${type}: ${count}`);
        }
      }

      lines.push('\nBy State:');
      for (const [state, count] of Object.entries(stats.byState)) {
        if (count > 0) {
          lines.push(`  ${state}: ${count}`);
        }
      }

      return lines.join('\n');
    } catch (error) {
      return `Failed to get stats: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * All registry tools
 */
export const agentRegistryTools: Tool[] = [
  registryListTool,
  registryQueryTool,
  registryGetTool,
  registryStatsTool,
];

/**
 * Create all registry tool executors
 */
export function createAgentRegistryToolExecutors(context: RegistryToolContext) {
  return {
    registry_list: createRegistryListExecutor(context),
    registry_query: createRegistryQueryExecutor(context),
    registry_get: createRegistryGetExecutor(context),
    registry_stats: createRegistryStatsExecutor(context),
  };
}

/**
 * Register all registry tools with a tool registry
 */
export function registerAgentRegistryTools(
  registry: ToolRegistry,
  context: RegistryToolContext
): void {
  const executors = createAgentRegistryToolExecutors(context);

  registry.register(registryListTool, executors.registry_list);
  registry.register(registryQueryTool, executors.registry_query);
  registry.register(registryGetTool, executors.registry_get);
  registry.register(registryStatsTool, executors.registry_stats);
}

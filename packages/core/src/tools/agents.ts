/**
 * Agent Spawning and Management Tools
 *
 * Tools that enable agents to spawn subagents, delegate tasks to named assistants,
 * and manage async agent jobs.
 */

import type { Tool, Assistant } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import type { SubagentManager, SubagentConfig, SubagentJob, SubagentInfo } from '../agent/subagent-manager';
import type { AssistantManager } from '../identity';

// ============================================
// Types
// ============================================

export interface AgentToolContext {
  /** Get the subagent manager */
  getSubagentManager: () => SubagentManager | null;
  /** Get the assistant manager */
  getAssistantManager: () => AssistantManager | null;
  /** Get current recursion depth */
  getDepth: () => number;
  /** Get working directory */
  getCwd: () => string;
  /** Get session ID */
  getSessionId: () => string;
}

// ============================================
// Tool Definitions
// ============================================

export const agentSpawnTool: Tool = {
  name: 'agent_spawn',
  description: `Spawn a subagent to handle a specific task. The subagent runs with limited context and tools.

Use this to delegate discrete tasks like:
- Searching and analyzing files
- Running a specific operation
- Gathering information

The subagent has no memory of the parent conversation - provide all needed context in the task and context parameters.`,
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The task/instruction for the subagent to complete. Be specific and include all necessary context.',
      },
      tools: {
        type: 'array',
        description: 'List of tool names the subagent can use. Default: read, glob, grep, bash, web_search, web_fetch',
        items: { type: 'string', description: 'Tool name' },
      },
      context: {
        type: 'string',
        description: 'Additional context to pass to the subagent (file contents, previous findings, etc.)',
      },
      maxTurns: {
        type: 'number',
        description: 'Maximum turns the subagent can take (default: 10, max: 25)',
      },
      async: {
        type: 'boolean',
        description: 'Run asynchronously and return job ID for later retrieval (default: false)',
      },
    },
    required: ['task'],
  },
};

export const agentListTool: Tool = {
  name: 'agent_list',
  description: 'List available assistants and currently running subagents.',
  parameters: {
    type: 'object',
    properties: {
      includeActive: {
        type: 'boolean',
        description: 'Include currently running subagents (default: true)',
      },
      includeJobs: {
        type: 'boolean',
        description: 'Include async subagent jobs (default: true)',
      },
    },
    required: [],
  },
};

export const agentDelegateTool: Tool = {
  name: 'agent_delegate',
  description: `Delegate a task to a specific named assistant. The assistant runs with its configured tools and system prompt.

Use this when you want to leverage a specialized assistant's capabilities.`,
  parameters: {
    type: 'object',
    properties: {
      assistant: {
        type: 'string',
        description: 'Name or ID of the assistant to delegate to',
      },
      task: {
        type: 'string',
        description: 'The task/instruction for the assistant',
      },
      context: {
        type: 'string',
        description: 'Additional context to include',
      },
      async: {
        type: 'boolean',
        description: 'Run asynchronously (default: false)',
      },
    },
    required: ['assistant', 'task'],
  },
};

export const agentJobStatusTool: Tool = {
  name: 'agent_job_status',
  description: 'Check status of an async agent job or wait for it to complete.',
  parameters: {
    type: 'object',
    properties: {
      jobId: {
        type: 'string',
        description: 'The job ID returned from agent_spawn or agent_delegate with async=true',
      },
      wait: {
        type: 'boolean',
        description: 'Wait for job to complete (default: false)',
      },
      timeout: {
        type: 'number',
        description: 'Max wait time in milliseconds (default: 30000)',
      },
    },
    required: ['jobId'],
  },
};

// ============================================
// Tool array for convenience
// ============================================

export const agentTools: Tool[] = [
  agentSpawnTool,
  agentListTool,
  agentDelegateTool,
  agentJobStatusTool,
];

// ============================================
// Response Types
// ============================================

interface AgentSpawnResponse {
  success: boolean;
  result?: string;
  error?: string;
  turns?: number;
  toolCalls?: number;
  jobId?: string;
}

interface AgentListResponse {
  assistants: Array<{
    id: string;
    name: string;
    description?: string;
    isActive: boolean;
  }>;
  activeSubagents: Array<{
    id: string;
    task: string;
    status: string;
    depth: number;
    runningForMs: number;
  }>;
  asyncJobs: Array<{
    id: string;
    task: string;
    status: string;
    startedAt: number;
    completedAt?: number;
  }>;
}

interface AgentDelegateResponse {
  success: boolean;
  result?: string;
  error?: string;
  assistant?: string;
  jobId?: string;
}

interface AgentJobStatusResponse {
  found: boolean;
  jobId: string;
  status?: string;
  result?: string;
  error?: string;
  turns?: number;
  toolCalls?: number;
  startedAt?: number;
  completedAt?: number;
}

// ============================================
// Tool Executors Factory
// ============================================

export function createAgentToolExecutors(
  context: AgentToolContext
): Record<string, ToolExecutor> {
  return {
    agent_spawn: async (input: Record<string, unknown>): Promise<string> => {
      const manager = context.getSubagentManager();
      if (!manager) {
        const response: AgentSpawnResponse = {
          success: false,
          error: 'Subagent spawning is not enabled',
        };
        return JSON.stringify(response, null, 2);
      }

      const task = String(input.task || '');
      if (!task.trim()) {
        const response: AgentSpawnResponse = {
          success: false,
          error: 'Task is required',
        };
        return JSON.stringify(response, null, 2);
      }

      const tools = Array.isArray(input.tools)
        ? input.tools.map(String)
        : undefined;
      const contextStr = typeof input.context === 'string' ? input.context : undefined;
      const maxTurns = typeof input.maxTurns === 'number' ? input.maxTurns : undefined;
      const async = input.async === true;

      const config: SubagentConfig = {
        task,
        tools,
        context: contextStr,
        maxTurns,
        async,
        parentSessionId: context.getSessionId(),
        depth: context.getDepth(),
        cwd: context.getCwd(),
      };

      // Check if spawning is allowed
      const canSpawn = manager.canSpawn(config.depth);
      if (!canSpawn.allowed) {
        const response: AgentSpawnResponse = {
          success: false,
          error: canSpawn.reason,
        };
        return JSON.stringify(response, null, 2);
      }

      if (async) {
        // Spawn asynchronously
        try {
          const jobId = await manager.spawnAsync(config);
          const response: AgentSpawnResponse = {
            success: true,
            jobId,
            result: `Subagent job started with ID: ${jobId}. Use agent_job_status to check progress.`,
          };
          return JSON.stringify(response, null, 2);
        } catch (error) {
          const response: AgentSpawnResponse = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
          return JSON.stringify(response, null, 2);
        }
      } else {
        // Spawn synchronously
        const result = await manager.spawn(config);
        const response: AgentSpawnResponse = {
          success: result.success,
          result: result.result,
          error: result.error,
          turns: result.turns,
          toolCalls: result.toolCalls,
        };
        return JSON.stringify(response, null, 2);
      }
    },

    agent_list: async (input: Record<string, unknown>): Promise<string> => {
      const manager = context.getSubagentManager();
      const assistantManager = context.getAssistantManager();

      const includeActive = input.includeActive !== false;
      const includeJobs = input.includeJobs !== false;

      // Get assistants
      const assistants = assistantManager?.listAssistants() ?? [];
      const activeAssistantId = assistantManager?.getActiveId();

      const response: AgentListResponse = {
        assistants: assistants.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          isActive: a.id === activeAssistantId,
        })),
        activeSubagents: [],
        asyncJobs: [],
      };

      if (manager) {
        if (includeActive) {
          const now = Date.now();
          response.activeSubagents = manager.listActive().map((info) => ({
            id: info.id,
            task: info.task.slice(0, 100) + (info.task.length > 100 ? '...' : ''),
            status: info.status,
            depth: info.depth,
            runningForMs: now - info.startedAt,
          }));
        }

        if (includeJobs) {
          response.asyncJobs = manager.listJobs().map((job) => ({
            id: job.id,
            task: job.config.task.slice(0, 100) + (job.config.task.length > 100 ? '...' : ''),
            status: job.status,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
          }));
        }
      }

      return JSON.stringify(response, null, 2);
    },

    agent_delegate: async (input: Record<string, unknown>): Promise<string> => {
      const manager = context.getSubagentManager();
      const assistantManager = context.getAssistantManager();

      if (!manager) {
        const response: AgentDelegateResponse = {
          success: false,
          error: 'Agent delegation is not enabled',
        };
        return JSON.stringify(response, null, 2);
      }

      if (!assistantManager) {
        const response: AgentDelegateResponse = {
          success: false,
          error: 'Assistant manager not available',
        };
        return JSON.stringify(response, null, 2);
      }

      const assistantQuery = String(input.assistant || '');
      const task = String(input.task || '');
      const contextStr = typeof input.context === 'string' ? input.context : undefined;
      const async = input.async === true;

      if (!assistantQuery.trim()) {
        const response: AgentDelegateResponse = {
          success: false,
          error: 'Assistant name or ID is required',
        };
        return JSON.stringify(response, null, 2);
      }

      if (!task.trim()) {
        const response: AgentDelegateResponse = {
          success: false,
          error: 'Task is required',
        };
        return JSON.stringify(response, null, 2);
      }

      // Find assistant by name or ID
      const assistants = assistantManager.listAssistants();
      const assistant = assistants.find(
        (a) =>
          a.id === assistantQuery ||
          a.name.toLowerCase() === assistantQuery.toLowerCase()
      );

      if (!assistant) {
        const response: AgentDelegateResponse = {
          success: false,
          error: `Assistant "${assistantQuery}" not found. Available: ${assistants.map((a) => a.name).join(', ')}`,
        };
        return JSON.stringify(response, null, 2);
      }

      // Build config for delegation
      // Use assistant's enabled tools if specified
      const tools = assistant.settings.enabledTools ?? undefined;

      // Build enhanced context with assistant info
      const enhancedContext = [
        `Delegated to assistant: ${assistant.name}`,
        assistant.description ? `Description: ${assistant.description}` : null,
        assistant.settings.systemPromptAddition
          ? `Instructions: ${assistant.settings.systemPromptAddition}`
          : null,
        contextStr ? `\nAdditional context:\n${contextStr}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const config: SubagentConfig = {
        task,
        tools,
        context: enhancedContext,
        parentSessionId: context.getSessionId(),
        depth: context.getDepth(),
        cwd: context.getCwd(),
      };

      // Check if spawning is allowed
      const canSpawn = manager.canSpawn(config.depth);
      if (!canSpawn.allowed) {
        const response: AgentDelegateResponse = {
          success: false,
          error: canSpawn.reason,
          assistant: assistant.name,
        };
        return JSON.stringify(response, null, 2);
      }

      if (async) {
        try {
          const jobId = await manager.spawnAsync(config);
          const response: AgentDelegateResponse = {
            success: true,
            jobId,
            assistant: assistant.name,
            result: `Delegated to ${assistant.name}. Job ID: ${jobId}`,
          };
          return JSON.stringify(response, null, 2);
        } catch (error) {
          const response: AgentDelegateResponse = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            assistant: assistant.name,
          };
          return JSON.stringify(response, null, 2);
        }
      } else {
        const result = await manager.spawn(config);
        const response: AgentDelegateResponse = {
          success: result.success,
          result: result.result,
          error: result.error,
          assistant: assistant.name,
        };
        return JSON.stringify(response, null, 2);
      }
    },

    agent_job_status: async (input: Record<string, unknown>): Promise<string> => {
      const manager = context.getSubagentManager();

      if (!manager) {
        const response: AgentJobStatusResponse = {
          found: false,
          jobId: String(input.jobId || ''),
          error: 'Subagent system not available',
        };
        return JSON.stringify(response, null, 2);
      }

      const jobId = String(input.jobId || '');
      const wait = input.wait === true;
      const timeout = typeof input.timeout === 'number' ? input.timeout : 30000;

      if (!jobId.trim()) {
        const response: AgentJobStatusResponse = {
          found: false,
          jobId: '',
          error: 'Job ID is required',
        };
        return JSON.stringify(response, null, 2);
      }

      if (wait) {
        // Wait for job to complete
        const result = await manager.waitForJob(jobId, timeout);
        const job = manager.getJobStatus(jobId);

        if (!job) {
          const response: AgentJobStatusResponse = {
            found: false,
            jobId,
            error: 'Job not found',
          };
          return JSON.stringify(response, null, 2);
        }

        const response: AgentJobStatusResponse = {
          found: true,
          jobId,
          status: job.status,
          result: result?.result,
          error: result?.error,
          turns: result?.turns,
          toolCalls: result?.toolCalls,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
        };
        return JSON.stringify(response, null, 2);
      } else {
        // Just check status
        const job = manager.getJobStatus(jobId);

        if (!job) {
          const response: AgentJobStatusResponse = {
            found: false,
            jobId,
            error: 'Job not found',
          };
          return JSON.stringify(response, null, 2);
        }

        const response: AgentJobStatusResponse = {
          found: true,
          jobId,
          status: job.status,
          result: job.result?.result,
          error: job.result?.error,
          turns: job.result?.turns,
          toolCalls: job.result?.toolCalls,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
        };
        return JSON.stringify(response, null, 2);
      }
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerAgentTools(
  registry: ToolRegistry,
  context: AgentToolContext
): void {
  const executors = createAgentToolExecutors(context);

  for (const tool of agentTools) {
    registry.register(tool, executors[tool.name]);
  }
}

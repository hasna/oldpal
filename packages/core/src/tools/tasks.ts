import type { Tool } from '@hasna/assistants-shared';
import {
  getTasks,
  getTask,
  addTask,
  getNextTask,
  startTask,
  completeTask,
  failTask,
  isPaused,
  getTaskCounts,
  type TaskPriority,
} from '../tasks';

export interface TasksToolContext {
  cwd: string;
  projectId?: string;
}

/**
 * Tool for listing tasks in the queue
 */
export const tasksListTool: Tool = {
  name: 'tasks_list',
  description: 'List all tasks in the task queue with their status and priority',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status: pending, in_progress, completed, failed, or all (default: all)',
        enum: ['pending', 'in_progress', 'completed', 'failed', 'all'],
      },
    },
  },
};

/**
 * Tool for getting task details
 */
export const tasksGetTool: Tool = {
  name: 'tasks_get',
  description: 'Get details of a specific task by ID',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The task ID',
      },
    },
    required: ['id'],
  },
};

/**
 * Tool for adding a new task
 */
export const tasksAddTool: Tool = {
  name: 'tasks_add',
  description: 'Add a new task to the queue',
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'The task description - what needs to be done',
      },
      priority: {
        type: 'string',
        description: 'Task priority: high, normal, or low (default: normal)',
        enum: ['high', 'normal', 'low'],
      },
    },
    required: ['description'],
  },
};

/**
 * Tool for getting the next pending task
 */
export const tasksNextTool: Tool = {
  name: 'tasks_next',
  description: 'Get the next pending task to work on (highest priority first)',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Tool for marking a task as completed
 */
export const tasksCompleteTool: Tool = {
  name: 'tasks_complete',
  description: 'Mark a task as completed with an optional result message',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The task ID',
      },
      result: {
        type: 'string',
        description: 'Optional result or summary of what was accomplished',
      },
    },
    required: ['id'],
  },
};

/**
 * Tool for marking a task as failed
 */
export const tasksFailTool: Tool = {
  name: 'tasks_fail',
  description: 'Mark a task as failed with an error message',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The task ID',
      },
      error: {
        type: 'string',
        description: 'The error message or reason for failure',
      },
    },
    required: ['id'],
  },
};

/**
 * Tool for checking queue status
 */
export const tasksStatusTool: Tool = {
  name: 'tasks_status',
  description: 'Get the current status of the task queue (counts by status, paused state)',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * All task management tools
 */
export const taskTools: Tool[] = [
  tasksListTool,
  tasksGetTool,
  tasksAddTool,
  tasksNextTool,
  tasksCompleteTool,
  tasksFailTool,
  tasksStatusTool,
];

/**
 * Create tool executors for task management
 */
export function createTaskToolExecutors(context: TasksToolContext) {
  return {
    tasks_list: async (input: { status?: string }) => {
      const tasks = await getTasks(context.cwd);
      const status = input.status || 'all';

      const filtered = status === 'all'
        ? tasks
        : tasks.filter((t) => t.status === status);

      if (filtered.length === 0) {
        return `No ${status === 'all' ? '' : status + ' '}tasks in queue.`;
      }

      const lines = filtered.map((t) => {
        const statusIcon = t.status === 'pending' ? '○' :
                          t.status === 'in_progress' ? '◐' :
                          t.status === 'completed' ? '●' : '✗';
        const priorityIcon = t.priority === 'high' ? '↑' :
                            t.priority === 'low' ? '↓' : '-';
        return `${statusIcon} [${priorityIcon}] ${t.id.slice(0, 8)} - ${t.description}`;
      });

      return `Tasks (${filtered.length}):\n${lines.join('\n')}`;
    },

    tasks_get: async (input: { id: string }) => {
      const task = await getTask(context.cwd, input.id);
      if (!task) {
        return `Task not found: ${input.id}`;
      }

      const lines = [
        `ID: ${task.id}`,
        `Description: ${task.description}`,
        `Status: ${task.status}`,
        `Priority: ${task.priority}`,
        `Created: ${new Date(task.createdAt).toISOString()}`,
      ];

      if (task.startedAt) {
        lines.push(`Started: ${new Date(task.startedAt).toISOString()}`);
      }
      if (task.completedAt) {
        lines.push(`Completed: ${new Date(task.completedAt).toISOString()}`);
      }
      if (task.result) {
        lines.push(`Result: ${task.result}`);
      }
      if (task.error) {
        lines.push(`Error: ${task.error}`);
      }

      return lines.join('\n');
    },

    tasks_add: async (input: { description: string; priority?: string }) => {
      const priority = (input.priority || 'normal') as TaskPriority;
      const task = await addTask(context.cwd, input.description, priority, context.projectId);
      return `Task added: ${task.id}\nDescription: ${task.description}\nPriority: ${task.priority}`;
    },

    tasks_next: async () => {
      const paused = await isPaused(context.cwd);
      if (paused) {
        return 'Task queue is paused. No tasks will be auto-processed.';
      }

      const task = await getNextTask(context.cwd);
      if (!task) {
        return 'No pending tasks in queue.';
      }

      // Mark as started
      await startTask(context.cwd, task.id);

      return `Next task:\nID: ${task.id}\nPriority: ${task.priority}\nDescription: ${task.description}`;
    },

    tasks_complete: async (input: { id: string; result?: string }) => {
      const task = await completeTask(context.cwd, input.id, input.result);
      if (!task) {
        return `Task not found: ${input.id}`;
      }
      return `Task completed: ${task.id}${input.result ? `\nResult: ${input.result}` : ''}`;
    },

    tasks_fail: async (input: { id: string; error?: string }) => {
      const task = await failTask(context.cwd, input.id, input.error);
      if (!task) {
        return `Task not found: ${input.id}`;
      }
      return `Task marked as failed: ${task.id}${input.error ? `\nError: ${input.error}` : ''}`;
    },

    tasks_status: async () => {
      const counts = await getTaskCounts(context.cwd);
      const paused = await isPaused(context.cwd);

      const lines = [
        `Queue Status: ${paused ? 'Paused' : 'Active'}`,
        `Pending: ${counts.pending}`,
        `In Progress: ${counts.in_progress}`,
        `Completed: ${counts.completed}`,
        `Failed: ${counts.failed}`,
        `Total: ${counts.pending + counts.in_progress + counts.completed + counts.failed}`,
      ];

      return lines.join('\n');
    },
  };
}

/**
 * Register task tools with a tool registry
 */
export function registerTaskTools(
  registry: { register: (tool: Tool, executor: (input: unknown) => Promise<string>) => void },
  context: TasksToolContext
): void {
  const executors = createTaskToolExecutors(context);

  for (const tool of taskTools) {
    const executor = executors[tool.name as keyof typeof executors];
    if (executor) {
      registry.register(tool, executor as (input: unknown) => Promise<string>);
    }
  }
}

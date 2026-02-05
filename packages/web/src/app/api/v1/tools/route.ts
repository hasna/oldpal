import { NextRequest } from 'next/server';
import { withApiKeyAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';

/**
 * Tool parameter property schema
 */
interface ToolPropertySchema {
  type: string | string[];
  description: string;
  enum?: string[];
  default?: unknown;
}

/**
 * Tool parameter schema
 */
interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
}

/**
 * Tool metadata for API response
 */
interface ToolMetadata {
  name: string;
  description: string;
  category: string;
  parameters?: ToolParameterSchema;
}

/**
 * Built-in tools available in assistants-core
 * These match the tools registered in the core package
 */
const BUILT_IN_TOOLS: ToolMetadata[] = [
  // System tools
  {
    name: 'bash',
    description: 'Execute shell commands (restricted to safe, read-only operations)',
    category: 'system',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command' },
        timeout: { type: 'number', description: 'Command timeout in milliseconds' },
      },
      required: ['command'],
    },
  },

  // Filesystem tools
  {
    name: 'read',
    description: 'Read the contents of a file',
    category: 'filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read' },
        encoding: { type: 'string', description: 'File encoding (default: utf-8)', default: 'utf-8' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write',
    description: 'Write content to a file (restricted to scripts folder)',
    category: 'filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to write' },
        content: { type: 'string', description: 'Content to write to the file' },
        append: { type: 'boolean', description: 'Append to existing file instead of overwriting', default: false },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern',
    category: 'filesystem',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match (e.g., "**/*.ts")' },
        cwd: { type: 'string', description: 'Base directory for the search' },
        ignore: { type: 'string', description: 'Patterns to ignore' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: 'Search for text patterns in files',
    category: 'filesystem',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regular expression pattern to search' },
        path: { type: 'string', description: 'File or directory to search in' },
        recursive: { type: 'boolean', description: 'Search recursively in directories', default: true },
        ignoreCase: { type: 'boolean', description: 'Case-insensitive search', default: false },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'read_pdf',
    description: 'Read and extract text from PDF documents',
    category: 'filesystem',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the PDF file' },
        pages: { type: 'string', description: 'Page range to extract (e.g., "1-5" or "1,3,5")' },
      },
      required: ['path'],
    },
  },

  // Web tools
  {
    name: 'web_fetch',
    description: 'Fetch content from a URL',
    category: 'web',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', description: 'HTTP method', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
        headers: { type: 'object', description: 'Request headers' },
      },
      required: ['url'],
    },
  },
  {
    name: 'curl',
    description: 'Execute HTTP requests with custom options',
    category: 'web',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to request' },
        method: { type: 'string', description: 'HTTP method', default: 'GET' },
        headers: { type: 'object', description: 'Request headers' },
        data: { type: 'string', description: 'Request body data' },
        timeout: { type: 'number', description: 'Request timeout in milliseconds' },
      },
      required: ['url'],
    },
  },

  // Image tools
  {
    name: 'display_image',
    description: 'Display an image from a file path or URL',
    category: 'media',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'File path or URL of the image' },
        alt: { type: 'string', description: 'Alternative text description' },
      },
      required: ['source'],
    },
  },

  // Timing tools
  {
    name: 'wait',
    description: 'Wait for a specified duration',
    category: 'timing',
    parameters: {
      type: 'object',
      properties: {
        duration: { type: 'number', description: 'Duration to wait in milliseconds' },
        reason: { type: 'string', description: 'Reason for waiting (for logging)' },
      },
      required: ['duration'],
    },
  },
  {
    name: 'sleep',
    description: 'Sleep for a specified duration (alias for wait)',
    category: 'timing',
    parameters: {
      type: 'object',
      properties: {
        duration: { type: 'number', description: 'Duration to sleep in milliseconds' },
      },
      required: ['duration'],
    },
  },

  // Scheduling tools
  {
    name: 'schedule',
    description: 'Schedule a command to run at a specific time or interval',
    category: 'scheduling',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        at: { type: 'string', description: 'Time to run (ISO 8601 or cron expression)' },
        interval: { type: 'number', description: 'Interval in milliseconds for recurring' },
        description: { type: 'string', description: 'Description of the schedule' },
      },
      required: ['command'],
    },
  },
  {
    name: 'pause_schedule',
    description: 'Pause a scheduled command',
    category: 'scheduling',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the schedule to pause' },
      },
      required: ['id'],
    },
  },
  {
    name: 'cancel_schedule',
    description: 'Cancel a scheduled command',
    category: 'scheduling',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the schedule to cancel' },
      },
      required: ['id'],
    },
  },

  // Interaction tools
  {
    name: 'feedback',
    description: 'Provide feedback, confirmation, or acknowledgment to the user',
    category: 'interaction',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Feedback message to display' },
        type: { type: 'string', description: 'Type of feedback', enum: ['info', 'success', 'warning', 'error'], default: 'info' },
      },
      required: ['message'],
    },
  },
  {
    name: 'ask_user',
    description: 'Ask the user clarifying questions and return structured answers',
    category: 'interaction',
    parameters: {
      type: 'object',
      properties: {
        questions: { type: 'array', description: 'Array of question objects' },
        title: { type: 'string', description: 'Title for the question dialog' },
      },
      required: ['questions'],
    },
  },

  // Memory tools (aligned with core/src/tools/memory.ts)
  {
    name: 'memory_save',
    description: 'Save information to persistent memory for future recall across sessions',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Unique identifier for this memory (e.g., "user.timezone")' },
        value: { type: 'string', description: 'The information to remember' },
        category: { type: 'string', description: 'Type of memory', enum: ['preference', 'fact', 'knowledge', 'history'] },
        scope: { type: 'string', description: 'Memory scope', enum: ['global', 'shared', 'private'], default: 'private' },
        scopeId: { type: 'string', description: 'Optional scope identifier for shared/private memories' },
        importance: { type: 'number', description: 'Importance score (1-10)', default: 5 },
        summary: { type: 'string', description: 'Optional short summary for quick recall' },
        tags: { type: 'array', description: 'Optional tags for categorization' },
      },
      required: ['key', 'value', 'category'],
    },
  },
  {
    name: 'memory_recall',
    description: 'Recall information from memory using key or search',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Specific key to recall (exact match)' },
        search: { type: 'string', description: 'Search term to find relevant memories' },
        category: { type: 'string', description: 'Filter by category', enum: ['preference', 'fact', 'knowledge', 'history'] },
        limit: { type: 'number', description: 'Maximum results to return', default: 5 },
      },
    },
  },
  {
    name: 'memory_list',
    description: 'List all memories matching criteria',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category', enum: ['preference', 'fact', 'knowledge', 'history'] },
        scope: { type: 'string', description: 'Filter by scope', enum: ['global', 'shared', 'private'] },
        minImportance: { type: 'number', description: 'Minimum importance level (1-10)' },
        limit: { type: 'number', description: 'Maximum results to return', default: 20 },
      },
    },
  },
  {
    name: 'memory_forget',
    description: 'Remove a memory entry',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The key of the memory to forget' },
      },
      required: ['key'],
    },
  },
  {
    name: 'memory_update',
    description: 'Update an existing memory metadata (importance, tags, or summary)',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The key of the memory to update' },
        importance: { type: 'number', description: 'New importance level (1-10)' },
        tags: { type: 'array', description: 'New tags (replaces existing)' },
        summary: { type: 'string', description: 'New summary text' },
      },
      required: ['key'],
    },
  },
  {
    name: 'memory_stats',
    description: 'Get statistics about stored memories',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'memory_export',
    description: 'Export all memories to JSON format',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category', enum: ['preference', 'fact', 'knowledge', 'history'] },
        scope: { type: 'string', description: 'Filter by scope', enum: ['global', 'shared', 'private'] },
      },
    },
  },
  {
    name: 'memory_import',
    description: 'Import memories from a JSON array',
    category: 'memory',
    parameters: {
      type: 'object',
      properties: {
        memories: { type: 'array', description: 'Array of memory objects to import' },
        overwrite: { type: 'boolean', description: 'Overwrite existing memories with same key', default: false },
      },
      required: ['memories'],
    },
  },

  // Agent tools (aligned with core/src/tools/agents.ts)
  {
    name: 'agent_spawn',
    description: 'Spawn a subagent to handle a specific task with limited context and tools',
    category: 'agents',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task/instruction for the subagent' },
        tools: { type: 'array', description: 'List of tool names the subagent can use' },
        context: { type: 'string', description: 'Additional context to pass to the subagent' },
        maxTurns: { type: 'number', description: 'Maximum turns (default: 10, max: 25)' },
        async: { type: 'boolean', description: 'Run asynchronously and return job ID', default: false },
      },
      required: ['task'],
    },
  },
  {
    name: 'agent_list',
    description: 'List available assistants and currently running subagents',
    category: 'agents',
    parameters: {
      type: 'object',
      properties: {
        includeActive: { type: 'boolean', description: 'Include running subagents', default: true },
        includeJobs: { type: 'boolean', description: 'Include async subagent jobs', default: true },
      },
    },
  },
  {
    name: 'agent_delegate',
    description: 'Delegate a task to a specific named assistant',
    category: 'agents',
    parameters: {
      type: 'object',
      properties: {
        assistant: { type: 'string', description: 'Name or ID of the assistant to delegate to' },
        task: { type: 'string', description: 'Task/instruction for the assistant' },
        context: { type: 'string', description: 'Additional context to include' },
        async: { type: 'boolean', description: 'Run asynchronously', default: false },
      },
      required: ['assistant', 'task'],
    },
  },
  {
    name: 'agent_job_status',
    description: 'Check status of an async agent job or wait for completion',
    category: 'agents',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID from agent_spawn or agent_delegate with async=true' },
        wait: { type: 'boolean', description: 'Wait for job to complete', default: false },
        timeout: { type: 'number', description: 'Max wait time in milliseconds', default: 30000 },
      },
      required: ['jobId'],
    },
  },
];

/**
 * Get unique categories from tools
 */
function getCategories(): string[] {
  const categories = new Set<string>();
  for (const tool of BUILT_IN_TOOLS) {
    categories.add(tool.category);
  }
  return Array.from(categories).sort();
}

// GET /api/v1/tools - List available tools with pagination and filtering
export const GET = withApiKeyAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);

    // Pagination params
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

    // Filter params
    const search = searchParams.get('search')?.toLowerCase();
    const category = searchParams.get('category');

    // Sort params
    const sortBy = searchParams.get('sortBy') || 'name';
    const sortDir = searchParams.get('sortDir') || 'asc';

    // Filter tools
    let filteredTools = [...BUILT_IN_TOOLS];

    if (search) {
      filteredTools = filteredTools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(search) ||
          tool.description.toLowerCase().includes(search)
      );
    }

    if (category) {
      filteredTools = filteredTools.filter((tool) => tool.category === category);
    }

    // Sort tools
    filteredTools.sort((a, b) => {
      const aValue = sortBy === 'category' ? a.category : a.name;
      const bValue = sortBy === 'category' ? b.category : b.name;
      const comparison = aValue.localeCompare(bValue);
      return sortDir === 'desc' ? -comparison : comparison;
    });

    // Paginate
    const total = filteredTools.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedTools = filteredTools.slice(offset, offset + limit);

    return successResponse({
      items: paginatedTools,
      total,
      page,
      limit,
      totalPages,
      categories: getCategories(),
    });
  } catch (error) {
    return errorResponse(error);
  }
});

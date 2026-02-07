import { NextRequest } from 'next/server';
import { withScopedApiKeyAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';

/**
 * Tool parameter property schema (supports nested array items)
 */
interface ToolPropertySchema {
  type: string | string[];
  description: string;
  enum?: string[];
  default?: unknown;
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
  items?: {
    type: string | string[];
    properties?: Record<string, ToolPropertySchema>;
    required?: string[];
  };
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
    description: 'Execute shell commands (restricted to safe, read-only operations by default; set validation.perTool.bash.allowAll to allow broader commands)',
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
        value: { type: ['string', 'number', 'boolean', 'object'], description: 'The information to remember. Can be a string, number, boolean, or object.' },
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
        tags: { type: 'array', description: 'Filter by tags (matches any)' },
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
        memories: {
          type: 'array',
          description: 'Array of memory objects to import',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Unique identifier' },
              value: { type: ['string', 'number', 'boolean', 'object'], description: 'The information to store. Can be a string, number, boolean, or object.' },
              category: { type: 'string', description: 'Type of memory', enum: ['preference', 'fact', 'knowledge', 'history'] },
              scope: { type: 'string', description: 'Memory scope', enum: ['global', 'shared', 'private'] },
              scopeId: { type: 'string', description: 'Scope identifier' },
              importance: { type: 'number', description: 'Importance 1-10' },
              summary: { type: 'string', description: 'Short summary' },
              tags: { type: 'array', description: 'Tags for categorization' },
            },
            required: ['key', 'value', 'category'],
          },
        },
        overwrite: { type: 'boolean', description: 'Overwrite existing memories with same key', default: false },
      },
      required: ['memories'],
    },
  },

  // Assistant tools (aligned with core/src/tools/assistants.ts)
  {
    name: 'assistant_spawn',
    description: 'Spawn a sub-assistant to handle a specific task with limited context and tools',
    category: 'assistants',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task/instruction for the sub-assistant' },
        tools: { type: 'array', description: 'List of tool names the sub-assistant can use' },
        context: { type: 'string', description: 'Additional context to pass to the sub-assistant' },
        maxTurns: { type: 'number', description: 'Maximum turns (default: 10, max: 25)' },
        async: { type: 'boolean', description: 'Run asynchronously and return job ID', default: false },
      },
      required: ['task'],
    },
  },
  {
    name: 'assistant_list_running',
    description: 'List available assistants and currently running sub-assistants',
    category: 'assistants',
    parameters: {
      type: 'object',
      properties: {
        includeActive: { type: 'boolean', description: 'Include running sub-assistants', default: true },
        includeJobs: { type: 'boolean', description: 'Include async sub-assistant jobs', default: true },
      },
    },
  },
  {
    name: 'assistant_delegate',
    description: 'Delegate a task to a specific named assistant',
    category: 'assistants',
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
    name: 'assistant_job_status',
    description: 'Check status of an async assistant job or wait for completion',
    category: 'assistants',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID from assistant_spawn or assistant_delegate with async=true' },
        wait: { type: 'boolean', description: 'Wait for job to complete', default: false },
        timeout: { type: 'number', description: 'Max wait time in milliseconds', default: 30000 },
      },
      required: ['jobId'],
    },
  },

  // Wallet tools (aligned with core/src/wallet/tools.ts)
  {
    name: 'wallet_list',
    description: 'List all payment cards stored in the wallet. Returns safe summaries (name, last 4 digits, expiry) without sensitive data.',
    category: 'wallet',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'wallet_add',
    description: 'Add a new payment card to the wallet. Stores securely in AWS Secrets Manager.',
    category: 'wallet',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'User-friendly name for the card (e.g., "Business Visa")' },
        cardholderName: { type: 'string', description: 'Cardholder name as printed on the card' },
        cardNumber: { type: 'string', description: 'Full card number (16 digits)' },
        expiryMonth: { type: 'string', description: 'Expiration month (01-12)' },
        expiryYear: { type: 'string', description: 'Expiration year (4 digits, e.g., "2028")' },
        cvv: { type: 'string', description: 'CVV/CVC security code (3-4 digits)' },
        billingLine1: { type: 'string', description: 'Billing address line 1 (optional)' },
        billingLine2: { type: 'string', description: 'Billing address line 2 (optional)' },
        billingCity: { type: 'string', description: 'Billing address city (optional)' },
        billingState: { type: 'string', description: 'Billing address state/province (optional)' },
        billingPostalCode: { type: 'string', description: 'Billing address postal/ZIP code (optional)' },
        billingCountry: { type: 'string', description: 'Billing address country code (optional, e.g., "US")' },
      },
      required: ['name', 'cardholderName', 'cardNumber', 'expiryMonth', 'expiryYear', 'cvv'],
    },
  },
  {
    name: 'wallet_get',
    description: 'Get full payment card details for automation or API payments. Rate limited to prevent abuse. Use for browser form filling or payment API calls.',
    category: 'wallet',
    parameters: {
      type: 'object',
      properties: {
        cardId: { type: 'string', description: 'The card ID to retrieve' },
        format: { type: 'string', description: 'Output format: "automation" for form filling, "payment" for API calls, or "full" for all details', enum: ['automation', 'payment', 'full'], default: 'automation' },
      },
      required: ['cardId'],
    },
  },
  {
    name: 'wallet_remove',
    description: 'Remove a payment card from the wallet. Card can be recovered within 30 days.',
    category: 'wallet',
    parameters: {
      type: 'object',
      properties: {
        cardId: { type: 'string', description: 'The card ID to remove' },
      },
      required: ['cardId'],
    },
  },

  // Secrets tools (aligned with core/src/secrets/tools.ts)
  {
    name: 'secrets_list',
    description: 'List all secrets (names only, no values). Returns secret names, descriptions, and scopes. Use to see what secrets are available.',
    category: 'secrets',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Filter by scope: "global" for shared secrets, "assistant" for assistant-specific secrets, or "all" for both. Default: all', enum: ['global', 'assistant', 'all'] },
      },
    },
  },
  {
    name: 'secrets_get',
    description: 'Get a secret value. Rate limited for security. If scope is not specified, checks assistant scope first, then falls back to global.',
    category: 'secrets',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Secret name (e.g., "GITHUB_TOKEN", "STRIPE_API_KEY")' },
        scope: { type: 'string', description: 'Secret scope: "global" or "assistant". Default: tries assistant first, then global', enum: ['global', 'assistant'] },
        format: { type: 'string', description: 'Output format: "plain" returns just the value, "metadata" returns full secret info, "env" returns NAME=value format. Default: plain', enum: ['plain', 'metadata', 'env'] },
      },
      required: ['name'],
    },
  },
  {
    name: 'secrets_set',
    description: 'Create or update a secret. Use for storing API keys, passwords, tokens, and other sensitive data. Stored securely in AWS Secrets Manager.',
    category: 'secrets',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Secret name (alphanumeric, underscores, hyphens). Must start with letter or underscore. E.g., "GITHUB_TOKEN", "my_api_key"' },
        value: { type: 'string', description: 'Secret value (API key, password, token, etc.)' },
        description: { type: 'string', description: 'Optional description of what this secret is for' },
        scope: { type: 'string', description: 'Secret scope: "global" for shared across all assistants, "assistant" for this assistant only. Default: assistant', enum: ['global', 'assistant'] },
      },
      required: ['name', 'value'],
    },
  },
  {
    name: 'secrets_delete',
    description: 'Delete a secret. Uses soft delete with 7-day recovery window.',
    category: 'secrets',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Secret name to delete' },
        scope: { type: 'string', description: 'Secret scope: "global" or "assistant". Default: assistant', enum: ['global', 'assistant'] },
      },
      required: ['name'],
    },
  },

  // Messages tools (aligned with core/src/messages/tools.ts)
  {
    name: 'messages_send',
    description: "Send a message to another assistant. Use assistant name or ID as recipient. Messages are delivered instantly to the recipient's inbox.",
    category: 'messages',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient assistant name or ID' },
        body: { type: 'string', description: 'Message body content' },
        subject: { type: 'string', description: 'Message subject (optional)' },
        priority: { type: 'string', description: 'Message priority: low, normal, high, or urgent (default: normal)', enum: ['low', 'normal', 'high', 'urgent'] },
        replyTo: { type: 'string', description: 'Message ID to reply to (optional, for threading)' },
      },
      required: ['to', 'body'],
    },
  },
  {
    name: 'messages_list',
    description: 'List messages in your inbox. Can filter by read status, thread, or sender.',
    category: 'messages',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of messages to return (default: 20)' },
        unreadOnly: { type: 'boolean', description: 'Only return unread messages (default: false)' },
        threadId: { type: 'string', description: 'Filter by thread ID (optional)' },
        from: { type: 'string', description: 'Filter by sender assistant name or ID (optional)' },
      },
    },
  },
  {
    name: 'messages_read',
    description: 'Read the full content of a message by its ID. Marks the message as read.',
    category: 'messages',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The message ID to read' },
      },
      required: ['id'],
    },
  },
  {
    name: 'messages_read_thread',
    description: 'Read all messages in a conversation thread. Messages are returned in chronological order.',
    category: 'messages',
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The thread ID to read' },
      },
      required: ['threadId'],
    },
  },
  {
    name: 'messages_delete',
    description: 'Delete a message from your inbox.',
    category: 'messages',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The message ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'messages_list_assistants',
    description: 'List all known assistants that you can send messages to. Shows assistant names and when they were last active.',
    category: 'messages',
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  // Inbox tools (aligned with core/src/inbox/tools.ts)
  {
    name: 'inbox_fetch',
    description: 'Fetch new emails from the inbox. Syncs emails from S3 storage to local cache.',
    category: 'inbox',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of emails to fetch (default: 20)' },
      },
    },
  },
  {
    name: 'inbox_list',
    description: 'List emails in the inbox. Returns a summary of cached emails.',
    category: 'inbox',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of emails to return (default: 20)' },
        unreadOnly: { type: 'boolean', description: 'Only return unread emails (default: false)' },
      },
    },
  },
  {
    name: 'inbox_read',
    description: 'Read the full content of an email by its ID.',
    category: 'inbox',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The email ID to read' },
      },
      required: ['id'],
    },
  },
  {
    name: 'inbox_download_attachment',
    description: 'Download an attachment from an email to local storage.',
    category: 'inbox',
    parameters: {
      type: 'object',
      properties: {
        emailId: { type: 'string', description: 'The email ID containing the attachment' },
        attachmentIndex: { type: 'number', description: 'The index of the attachment (0-based)' },
      },
      required: ['emailId', 'attachmentIndex'],
    },
  },
  {
    name: 'inbox_send',
    description: 'Send an email from the assistant inbox.',
    category: 'inbox',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address (or comma-separated list)' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text or markdown)' },
        html: { type: 'string', description: 'Optional HTML body' },
        replyToId: { type: 'string', description: 'Optional email ID to reply to (sets proper headers)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },

  // Project tools (aligned with core/src/tools/projects.ts)
  {
    name: 'project_list',
    description: 'List all projects in the current working directory. Returns project names, descriptions, and summary statistics.',
    category: 'projects',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'project_get',
    description: 'Get detailed information about a specific project, including its context entries and plans.',
    category: 'projects',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name to retrieve (case-insensitive)' },
        id: { type: 'string', description: 'Project ID to retrieve (alternative to name)' },
      },
    },
  },
  {
    name: 'project_create',
    description: 'Create a new project for organizing work, context, and plans.',
    category: 'projects',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name (must be unique in the workspace)' },
        description: { type: 'string', description: 'Optional project description' },
      },
      required: ['name'],
    },
  },
  {
    name: 'project_update',
    description: "Update a project's name or description.",
    category: 'projects',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Project ID to update' },
        name: { type: 'string', description: 'New project name (optional)' },
        description: { type: 'string', description: 'New project description (optional)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'project_delete',
    description: 'Delete a project and all its associated data (context entries, plans).',
    category: 'projects',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Project ID to delete' },
      },
      required: ['id'],
    },
  },

  // Plan tools (aligned with core/src/tools/projects.ts)
  {
    name: 'plan_list',
    description: 'List all plans for a specific project.',
    category: 'plans',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (optional, uses most recent project if not specified)' },
      },
    },
  },
  {
    name: 'plan_get',
    description: 'Get detailed information about a specific plan, including all steps.',
    category: 'plans',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID containing the plan' },
        planId: { type: 'string', description: 'Plan ID to retrieve' },
      },
      required: ['projectId', 'planId'],
    },
  },
  {
    name: 'plan_create',
    description: 'Create a new plan within a project for tracking implementation steps.',
    category: 'plans',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID (optional, uses most recent project if not specified)' },
        title: { type: 'string', description: 'Plan title' },
        steps: { type: 'array', description: 'Optional initial steps to add to the plan' },
      },
      required: ['title'],
    },
  },
  {
    name: 'plan_add_step',
    description: 'Add a new step to an existing plan.',
    category: 'plans',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID containing the plan' },
        planId: { type: 'string', description: 'Plan ID to add the step to' },
        text: { type: 'string', description: 'Step description' },
        status: { type: 'string', description: 'Initial step status (default: todo)', enum: ['todo', 'doing', 'done', 'blocked'] },
      },
      required: ['projectId', 'planId', 'text'],
    },
  },
  {
    name: 'plan_update_step',
    description: "Update a plan step's status or description.",
    category: 'plans',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID containing the plan' },
        planId: { type: 'string', description: 'Plan ID containing the step' },
        stepId: { type: 'string', description: 'Step ID to update' },
        text: { type: 'string', description: 'New step description (optional)' },
        status: { type: 'string', description: 'New step status (optional)', enum: ['todo', 'doing', 'done', 'blocked'] },
      },
      required: ['projectId', 'planId', 'stepId'],
    },
  },
  {
    name: 'plan_remove_step',
    description: 'Remove a step from a plan.',
    category: 'plans',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID containing the plan' },
        planId: { type: 'string', description: 'Plan ID containing the step' },
        stepId: { type: 'string', description: 'Step ID to remove' },
      },
      required: ['projectId', 'planId', 'stepId'],
    },
  },
  {
    name: 'plan_delete',
    description: 'Delete an entire plan from a project.',
    category: 'plans',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID containing the plan' },
        planId: { type: 'string', description: 'Plan ID to delete' },
      },
      required: ['projectId', 'planId'],
    },
  },

  // Skill tools (aligned with core/src/tools/skills.ts)
  {
    name: 'skill_create',
    description: 'Create a skill (SKILL.md). Requires explicit scope (project or global).',
    category: 'skills',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name without the "skill-" prefix' },
        scope: { type: 'string', description: 'Where to create the skill', enum: ['project', 'global'] },
        description: { type: 'string', description: 'Short description for the skill' },
        content: { type: 'string', description: 'Skill body content (markdown)' },
        allowed_tools: { type: 'array', description: 'Allowed tools for the skill' },
        argument_hint: { type: 'string', description: 'Argument hint for invocation' },
        overwrite: { type: 'boolean', description: 'Overwrite if skill already exists', default: false },
      },
      required: ['name'],
    },
  },
  {
    name: 'skills_list',
    description: 'List available skills and their descriptions.',
    category: 'skills',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory to scan for skills' },
      },
    },
  },
  {
    name: 'skill_read',
    description: 'Load and return the full content of a skill.',
    category: 'skills',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name to load' },
      },
      required: ['name'],
    },
  },
  {
    name: 'skill_execute',
    description: 'Execute a skill by name with optional arguments. Returns the prepared skill content for you to follow.',
    category: 'skills',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name to execute (e.g., "commit", "review-pr")' },
        arguments: { type: 'string', description: 'Arguments to pass to the skill (replaces $ARGUMENTS in skill content)' },
      },
      required: ['name'],
    },
  },

  // Session tools (aligned with core/src/sessions/tools.ts)
  {
    name: 'session_info',
    description: 'Get information about the current session including ID, label, assistant, and metadata.',
    category: 'sessions',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'session_list',
    description: 'List sessions owned by the current user. Can filter by search term or assistant ID.',
    category: 'sessions',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of results to return (default: 20, max: 50)' },
        search: { type: 'string', description: 'Search term to filter by session label' },
        assistantId: { type: 'string', description: 'Filter sessions by assistant UUID' },
      },
    },
  },
  {
    name: 'session_create',
    description: 'Create a new session with optional label, assistant assignment, and metadata.',
    category: 'sessions',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Session label/name (auto-generated if not provided)' },
        assistantId: { type: 'string', description: 'Assistant UUID to assign to this session' },
        metadata: { type: 'object', description: 'Custom metadata to attach to the session' },
      },
    },
  },
  {
    name: 'session_update',
    description: "Update a session's label or metadata. If no session ID is provided, updates the current session.",
    category: 'sessions',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session UUID to update (defaults to current session)' },
        label: { type: 'string', description: 'New label for the session' },
        metadata: { type: 'object', description: 'Metadata to merge with existing metadata' },
      },
    },
  },
  {
    name: 'session_delete',
    description: 'Delete a session and all its associated messages. Cannot delete the current session.',
    category: 'sessions',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session UUID to delete' },
      },
      required: ['sessionId'],
    },
  },

  // Job tools (aligned with core/src/jobs/tools.ts)
  {
    name: 'job_status',
    description: 'Check the status of a background job. Returns the current status (pending, running, completed, failed, timeout, cancelled) and any available result or error.',
    category: 'jobs',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The ID of the job to check' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'job_result',
    description: 'Get the result of a background job. Optionally wait up to 30 seconds for the job to complete if still running.',
    category: 'jobs',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The ID of the job to get results from' },
        wait: { type: 'boolean', description: 'Whether to wait up to 30 seconds for the job to complete (default: false)', default: false },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'job_cancel',
    description: 'Cancel a running or pending background job.',
    category: 'jobs',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The ID of the job to cancel' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'job_list',
    description: 'List all background jobs for the current session.',
    category: 'jobs',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status (pending, running, completed, failed, timeout, cancelled)', enum: ['pending', 'running', 'completed', 'failed', 'timeout', 'cancelled'] },
      },
    },
  },
  {
    name: 'job_clear',
    description: 'Clear completed, failed, timed out, or cancelled jobs for the current session. Running and pending jobs are not affected.',
    category: 'jobs',
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  // Tasks tools (aligned with core/src/tools/tasks.ts)
  {
    name: 'tasks_list',
    description: 'List all tasks in the task queue with their status and priority',
    category: 'tasks',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: pending, in_progress, completed, failed, or all (default: all)', enum: ['pending', 'in_progress', 'completed', 'failed', 'all'] },
      },
    },
  },
  {
    name: 'tasks_get',
    description: 'Get details of a specific task by ID',
    category: 'tasks',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tasks_add',
    description: 'Add a new task to the queue',
    category: 'tasks',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'The task description - what needs to be done' },
        priority: { type: 'string', description: 'Task priority: high, normal, or low (default: normal)', enum: ['high', 'normal', 'low'] },
      },
      required: ['description'],
    },
  },
  {
    name: 'tasks_next',
    description: 'Get the next pending task to work on (highest priority first)',
    category: 'tasks',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tasks_complete',
    description: 'Mark a task as completed with an optional result message',
    category: 'tasks',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task ID' },
        result: { type: 'string', description: 'Optional result or summary of what was accomplished' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tasks_fail',
    description: 'Mark a task as failed with an error message',
    category: 'tasks',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task ID' },
        error: { type: 'string', description: 'The error message or reason for failure' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tasks_status',
    description: 'Get the current status of the task queue (counts by status, paused state)',
    category: 'tasks',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tasks_recurring_list',
    description: 'List all recurring task templates with their schedule and next run time',
    category: 'tasks',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'tasks_recurring_add',
    description: 'Add a new recurring task that creates instances on a schedule',
    category: 'tasks',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'The task description - what needs to be done each time' },
        kind: { type: 'string', description: 'Recurrence type', enum: ['cron', 'interval'] },
        cron: { type: 'string', description: 'Cron expression (for kind: "cron"), e.g., "0 9 * * 1"' },
        intervalMs: { type: 'number', description: 'Interval in milliseconds (for kind: "interval")' },
        timezone: { type: 'string', description: 'Timezone for cron schedules' },
        maxOccurrences: { type: 'number', description: 'Maximum number of times to run (optional)' },
        priority: { type: 'string', description: 'Task priority', enum: ['high', 'normal', 'low'] },
      },
      required: ['description', 'kind'],
    },
  },
  {
    name: 'tasks_recurring_cancel',
    description: 'Cancel a recurring task, stopping future instances from being created',
    category: 'tasks',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The recurring task template ID to cancel' },
      },
      required: ['id'],
    },
  },

  // Assistant tools (aligned with core/src/tools/assistant.ts)
  {
    name: 'assistant_list',
    description: 'List all configured assistants with their details (id, name, description, model, active status).',
    category: 'assistants',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'assistant_get',
    description: 'Get detailed information about a specific assistant by ID.',
    category: 'assistants',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The assistant ID to retrieve' },
      },
      required: ['id'],
    },
  },
  {
    name: 'assistant_create',
    description: 'Create a new assistant with the specified configuration.',
    category: 'assistants',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the new assistant' },
        description: { type: 'string', description: 'Optional description of the assistant' },
        model: { type: 'string', description: 'LLM model to use (e.g., "claude-opus-4-5")' },
        systemPromptAddition: { type: 'string', description: 'Optional system prompt addition' },
        maxTokens: { type: 'number', description: 'Optional maximum tokens per response' },
        temperature: { type: 'number', description: 'Optional temperature setting (0.0-1.0)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'assistant_update',
    description: "Update an existing assistant's configuration.",
    category: 'assistants',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The assistant ID to update' },
        name: { type: 'string', description: 'New name for the assistant' },
        description: { type: 'string', description: 'New description' },
        model: { type: 'string', description: 'New LLM model' },
        systemPromptAddition: { type: 'string', description: 'New system prompt addition' },
        maxTokens: { type: 'number', description: 'New max tokens setting' },
        temperature: { type: 'number', description: 'New temperature setting' },
      },
      required: ['id'],
    },
  },
  {
    name: 'assistant_delete',
    description: 'Delete an assistant. Cannot delete the currently active assistant.',
    category: 'assistants',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The assistant ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'assistant_switch',
    description: 'Switch to a different assistant. Changes the active assistant for the current session.',
    category: 'assistants',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The assistant ID to switch to' },
      },
      required: ['id'],
    },
  },

  // Model tools (aligned with core/src/tools/model.ts)
  {
    name: 'model_list',
    description: 'List all available LLM models with their details (provider, context window, cost, capabilities).',
    category: 'models',
    parameters: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Filter by provider', enum: ['anthropic', 'openai'] },
      },
    },
  },
  {
    name: 'model_get',
    description: 'Get detailed information about a specific model by ID.',
    category: 'models',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The model ID to retrieve details for' },
      },
      required: ['id'],
    },
  },
  {
    name: 'model_current',
    description: 'Get information about the currently active model.',
    category: 'models',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'model_switch',
    description: 'Switch to a different LLM model. Changes take effect immediately.',
    category: 'models',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The model ID to switch to' },
      },
      required: ['id'],
    },
  },

  // Config tools (aligned with core/src/tools/config.ts)
  {
    name: 'config_get',
    description: 'Read a configuration value. Supports both project and global config.',
    category: 'config',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Config path (e.g., "llm.model", "context.maxTokens")' },
        scope: { type: 'string', description: 'Config scope', enum: ['project', 'global'], default: 'project' },
      },
      required: ['path'],
    },
  },
  {
    name: 'config_set',
    description: 'Update a configuration value. Only safe paths can be modified.',
    category: 'config',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Config path to update' },
        value: { type: ['string', 'number', 'boolean', 'array'], description: 'New value to set' },
        scope: { type: 'string', description: 'Config scope', enum: ['project', 'global'], default: 'project' },
      },
      required: ['path', 'value'],
    },
  },

  // Identity tools (aligned with core/src/tools/identity.ts)
  {
    name: 'identity_list',
    description: 'List all identities for the current assistant with their details.',
    category: 'identity',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'identity_create',
    description: 'Create a new identity for the current assistant. Can use templates.',
    category: 'identity',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the new identity' },
        template: { type: 'string', description: 'Template to use', enum: ['tech-support', 'professional', 'creative', 'analyst', 'mentor', 'developer'] },
        displayName: { type: 'string', description: 'Display name' },
        title: { type: 'string', description: 'Role or job title' },
        company: { type: 'string', description: 'Company name' },
        timezone: { type: 'string', description: 'Timezone (e.g., "UTC")' },
        communicationStyle: { type: 'string', description: 'Communication style' },
        email: { type: 'string', description: 'Primary email address' },
        phone: { type: 'string', description: 'Primary phone number' },
        virtualAddress: { type: 'string', description: 'Primary virtual address (handle, URL, or DID)' },
        address: {
          type: 'object',
          description: 'Primary physical address',
          properties: {
            street: { type: 'string', description: 'Street address line' },
            city: { type: 'string', description: 'City or locality' },
            state: { type: 'string', description: 'State, province, or region' },
            postalCode: { type: 'string', description: 'ZIP or postal code' },
            country: { type: 'string', description: 'Country name or code' },
            label: { type: 'string', description: 'Address label (e.g., Primary, Office)' },
          },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'identity_update',
    description: "Update an existing identity's settings.",
    category: 'identity',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identity ID to update' },
        name: { type: 'string', description: 'New name' },
        displayName: { type: 'string', description: 'New display name' },
        title: { type: 'string', description: 'New role or title' },
        company: { type: 'string', description: 'New company' },
        timezone: { type: 'string', description: 'New timezone' },
        communicationStyle: { type: 'string', description: 'New communication style' },
        email: { type: 'string', description: 'Primary email address' },
        phone: { type: 'string', description: 'Primary phone number' },
        virtualAddress: { type: 'string', description: 'Primary virtual address (handle, URL, or DID)' },
        address: {
          type: 'object',
          description: 'Primary physical address',
          properties: {
            street: { type: 'string', description: 'Street address line' },
            city: { type: 'string', description: 'City or locality' },
            state: { type: 'string', description: 'State, province, or region' },
            postalCode: { type: 'string', description: 'ZIP or postal code' },
            country: { type: 'string', description: 'Country name or code' },
            label: { type: 'string', description: 'Address label (e.g., Primary, Office)' },
          },
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'identity_delete',
    description: 'Delete an identity. Cannot delete the active identity.',
    category: 'identity',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identity ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'identity_switch',
    description: 'Switch to a different identity for the current assistant.',
    category: 'identity',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identity ID to switch to' },
      },
      required: ['id'],
    },
  },

  // Energy tools (aligned with core/src/tools/energy.ts)
  {
    name: 'energy_rest',
    description: 'Recharge energy by resting. Restores energy points (default: 20% of max).',
    category: 'energy',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount of energy to restore' },
      },
    },
  },
  {
    name: 'energy_info',
    description: 'Get detailed information about current energy state including level, effects, and recommendations.',
    category: 'energy',
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  // Security tools (aligned with core/src/tools/security.ts)
  {
    name: 'security_log_list',
    description: 'List security log events. Shows blocked commands, path violations, and validation failures.',
    category: 'security',
    parameters: {
      type: 'object',
      properties: {
        severity: { type: 'string', description: 'Filter by severity', enum: ['critical', 'high', 'medium', 'low'] },
        eventType: { type: 'string', description: 'Filter by event type', enum: ['blocked_command', 'path_violation', 'validation_failure'] },
        sessionOnly: { type: 'boolean', description: 'Only show events from current session (default: true)' },
        limit: { type: 'number', description: 'Maximum events to return (default: 50)' },
      },
    },
  },
  {
    name: 'security_log_clear',
    description: 'Clear the in-memory security log. Does not affect persisted log file.',
    category: 'security',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'security_log_summary',
    description: 'Get a summary of security events showing counts by type and severity.',
    category: 'security',
    parameters: {
      type: 'object',
      properties: {
        sessionOnly: { type: 'boolean', description: 'Only show events from current session (default: true)' },
      },
    },
  },

  // Self-awareness tools (aligned with core/src/tools/self-awareness.ts)
  {
    name: 'context_get',
    description: 'Get current conversation context state including token count, message count, and summarization status. Use this to understand how much context space is used.',
    category: 'self-awareness',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'context_stats',
    description: 'Get detailed statistics about context management including compression history, limits, and configuration.',
    category: 'self-awareness',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'whoami',
    description: 'Get current assistant identity - name, model, session ID, and active identity. Quick way to identify yourself.',
    category: 'self-awareness',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'identity_get',
    description: 'Get full identity information including profile, preferences, and communication style. Returns detailed identity data.',
    category: 'self-awareness',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'energy_status',
    description: 'Get current energy state, level, and any effects (like response modifications). Check before expensive operations.',
    category: 'self-awareness',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'resource_limits',
    description: 'Get current resource limits including context window, energy thresholds, and wallet rate limits. Use for planning multi-step operations.',
    category: 'self-awareness',
    parameters: {
      type: 'object',
      properties: {},
    },
  },

  // Voice tools (aligned with core/src/tools/voice.ts)
  {
    name: 'voice_enable',
    description: 'Enable voice mode for text-to-speech output and speech-to-text input.',
    category: 'voice',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'voice_disable',
    description: 'Disable voice mode. Stops any active speaking or listening.',
    category: 'voice',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'voice_status',
    description: 'Get the current voice mode status including enabled state, speaking/listening activity, and configured providers.',
    category: 'voice',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'voice_say',
    description: 'Speak text aloud using text-to-speech. Voice mode must be enabled.',
    category: 'voice',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to speak aloud' },
      },
      required: ['text'],
    },
  },
  {
    name: 'voice_listen',
    description: 'Listen for speech and transcribe it to text. Voice mode must be enabled. Returns the transcribed text.',
    category: 'voice',
    parameters: {
      type: 'object',
      properties: {
        durationSeconds: { type: 'number', description: 'Maximum recording duration in seconds (optional)' },
      },
    },
  },
  {
    name: 'voice_stop',
    description: 'Stop any active speaking or listening.',
    category: 'voice',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'What to stop: speaking, listening, or all (default: all)', enum: ['speaking', 'listening', 'all'] },
      },
    },
  },

  // Connector tools (aligned with core/src/tools/connector.ts)
  {
    name: 'connectors_list',
    description: 'List all discovered connectors and their available commands. Use this to discover what connectors are available and what operations they support.',
    category: 'connectors',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional: filter to a specific connector by name' },
        verbose: { type: 'boolean', description: 'Optional: include detailed command information (default: false)' },
        page: { type: 'number', description: 'Optional: page number for paginated results (default: 1)' },
        limit: { type: 'number', description: 'Optional: items per page (default: 10, max: 50)' },
      },
    },
  },
  {
    name: 'connectors_search',
    description: 'Search for connectors by name, description, or command. Use this to find the right connector for a task when many are available.',
    category: 'connectors',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match against connector names, descriptions, and commands' },
        limit: { type: 'number', description: 'Maximum number of results to return (default: 5, max: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'connector_execute',
    description: 'Execute a command on any discovered connector. Use connectors_list or connectors_search first to discover available connectors and their commands.',
    category: 'connectors',
    parameters: {
      type: 'object',
      properties: {
        connector: { type: 'string', description: 'Name of the connector to use (e.g., "notion", "gmail", "googledrive")' },
        command: { type: 'string', description: 'The command to run on the connector' },
        args: { type: 'array', description: 'Arguments to pass to the command' },
        options: { type: 'object', description: 'Options to pass to the command (key-value pairs)' },
      },
      required: ['connector', 'command'],
    },
  },
  {
    name: 'connector_autorefresh',
    description: 'Enable, disable, list, or update global auto-refresh schedules for connector auth tokens. Runs in the background and is not tied to a session.',
    category: 'connectors',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action to perform', enum: ['enable', 'disable', 'remove', 'status', 'list'] },
        connector: { type: 'string', description: 'Connector name (e.g., "notion", "gmail")' },
        cron: { type: 'string', description: 'Cron expression for refresh schedule (e.g., "0 * * * *")' },
        timezone: { type: 'string', description: 'Timezone for cron schedules (optional)' },
        intervalMinutes: { type: 'number', description: 'Interval in minutes (alternative to cron)' },
        intervalHours: { type: 'number', description: 'Interval in hours (alternative to cron)' },
        command: { type: 'string', description: 'Connector command to run (default: "auth refresh")' },
      },
      required: ['action'],
    },
  },

  // Tool discovery tools (aligned with core/src/tools/search.ts)
  {
    name: 'tools_search',
    description: 'Search for available tools by name, description, category, or tags. Use this to find the right tool for a task without loading all tools into context.',
    category: 'discovery',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match against tool names and descriptions' },
        category: { type: 'string', description: 'Filter by category (e.g., "memory", "filesystem", "web", "assistants")' },
        tags: { type: 'array', description: 'Filter by tags (e.g., ["search", "create"])' },
        source: { type: 'string', description: 'Filter by source', enum: ['builtin', 'connector', 'skill', 'custom'] },
        limit: { type: 'number', description: 'Maximum number of results to return (default: 10, max: 50)' },
      },
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
// Requires 'read:tools' scope for API key access, JWT tokens have full access
export const GET = withScopedApiKeyAuth(['read:tools'], async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);

    // Pagination params (handle invalid/NaN values with fallback)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));

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

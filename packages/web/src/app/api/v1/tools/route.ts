import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';

/**
 * Tool metadata for API response
 */
interface ToolMetadata {
  name: string;
  description: string;
  category: string;
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
  },

  // Filesystem tools
  {
    name: 'read',
    description: 'Read the contents of a file',
    category: 'filesystem',
  },
  {
    name: 'write',
    description: 'Write content to a file (restricted to scripts folder)',
    category: 'filesystem',
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern',
    category: 'filesystem',
  },
  {
    name: 'grep',
    description: 'Search for text patterns in files',
    category: 'filesystem',
  },
  {
    name: 'read_pdf',
    description: 'Read and extract text from PDF documents',
    category: 'filesystem',
  },

  // Web tools
  {
    name: 'web_fetch',
    description: 'Fetch content from a URL',
    category: 'web',
  },
  {
    name: 'curl',
    description: 'Execute HTTP requests with custom options',
    category: 'web',
  },

  // Image tools
  {
    name: 'display_image',
    description: 'Display an image from a file path or URL',
    category: 'media',
  },

  // Timing tools
  {
    name: 'wait',
    description: 'Wait for a specified duration',
    category: 'timing',
  },
  {
    name: 'sleep',
    description: 'Sleep for a specified duration (alias for wait)',
    category: 'timing',
  },

  // Scheduling tools
  {
    name: 'schedule',
    description: 'Schedule a command to run at a specific time or interval',
    category: 'scheduling',
  },
  {
    name: 'pause_schedule',
    description: 'Pause a scheduled command',
    category: 'scheduling',
  },
  {
    name: 'cancel_schedule',
    description: 'Cancel a scheduled command',
    category: 'scheduling',
  },

  // Interaction tools
  {
    name: 'feedback',
    description: 'Provide feedback, confirmation, or acknowledgment to the user',
    category: 'interaction',
  },
  {
    name: 'ask_user',
    description: 'Ask the user clarifying questions and return structured answers',
    category: 'interaction',
  },
];

// GET /api/v1/tools - List available tools
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    return successResponse({
      tools: BUILT_IN_TOOLS,
      count: BUILT_IN_TOOLS.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

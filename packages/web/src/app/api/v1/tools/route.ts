import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';

// Note: In a full implementation, this would load tools from the core package
// For now, we return a placeholder list
const AVAILABLE_TOOLS = [
  {
    name: 'bash',
    description: 'Execute bash commands',
    category: 'system',
  },
  {
    name: 'read-file',
    description: 'Read contents of a file',
    category: 'filesystem',
  },
  {
    name: 'write-file',
    description: 'Write contents to a file',
    category: 'filesystem',
  },
  {
    name: 'list-files',
    description: 'List files in a directory',
    category: 'filesystem',
  },
  {
    name: 'search-files',
    description: 'Search for files matching a pattern',
    category: 'filesystem',
  },
  {
    name: 'web-fetch',
    description: 'Fetch content from a URL',
    category: 'web',
  },
];

// GET /api/v1/tools - List available tools
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    return successResponse({
      tools: AVAILABLE_TOOLS,
      count: AVAILABLE_TOOLS.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

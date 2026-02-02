import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';

// Note: In a full implementation, this would load skills from the core package
// For now, we return a placeholder list
const AVAILABLE_SKILLS = [
  {
    name: 'code-review',
    description: 'Review code for best practices, bugs, and improvements',
    category: 'development',
  },
  {
    name: 'summarize',
    description: 'Summarize text or documents',
    category: 'text',
  },
  {
    name: 'translate',
    description: 'Translate text between languages',
    category: 'text',
  },
  {
    name: 'explain-code',
    description: 'Explain code in plain language',
    category: 'development',
  },
];

// GET /api/v1/skills - List available skills
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    return successResponse({
      skills: AVAILABLE_SKILLS,
      count: AVAILABLE_SKILLS.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { SkillLoader } from '@hasna/assistants-core';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Skill metadata returned by the API
 */
interface SkillMetadata {
  name: string;
  description: string;
  argumentHint?: string;
  userInvocable: boolean;
}

/**
 * Get the user's global skills directory path
 */
function getGlobalSkillsDir(): string {
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const userHome = envHome && envHome.trim().length > 0 ? envHome : homedir();
  return join(userHome, '.assistants', 'shared', 'skills');
}

// GET /api/v1/skills - List available skills
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    // Create a skill loader and load user's global skills
    const skillLoader = new SkillLoader();

    // Load skills without content (just metadata)
    await skillLoader.loadFromDirectory(getGlobalSkillsDir(), { includeContent: false });

    // Get all loaded skills and map to API response format
    const skills = skillLoader.getSkills();
    const skillMetadata: SkillMetadata[] = skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      argumentHint: skill.argumentHint,
      userInvocable: skill.userInvocable !== false,
    }));

    return successResponse({
      skills: skillMetadata,
      count: skillMetadata.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

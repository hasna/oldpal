import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError } from '@/lib/api/errors';
import { SkillLoader } from '@hasna/assistants-core';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Skill detail response for API
 */
interface SkillDetailResponse {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  userInvocable: boolean;
  model?: string;
  context?: string;
  agent?: string;
  filePath: string;
  category: string;
  content: string;
}

/**
 * Get the user's global skills directory path
 */
function getGlobalSkillsDir(): string {
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const userHome = envHome && envHome.trim().length > 0 ? envHome : homedir();
  return join(userHome, '.assistants', 'shared', 'skills');
}

/**
 * Derive category from file path
 */
function deriveCategory(filePath: string): string {
  if (filePath.includes('shared/skills')) {
    return 'shared';
  }
  if (filePath.includes('.assistants/skills')) {
    return 'project';
  }
  return 'other';
}

// GET /api/v1/skills/[name] - Get skill detail by name
export const GET = withAuth(async (
  request: AuthenticatedRequest,
  { params }: { params: Promise<{ name: string }> }
) => {
  try {
    const { name } = await params;

    // Create a skill loader and load skills with content
    const skillLoader = new SkillLoader();
    await skillLoader.loadFromDirectory(getGlobalSkillsDir(), { includeContent: true });

    // Find the skill by name
    const skill = skillLoader.getSkill(name);

    if (!skill) {
      throw new NotFoundError(`Skill '${name}' not found`);
    }

    const response: SkillDetailResponse = {
      name: skill.name,
      description: skill.description,
      argumentHint: skill.argumentHint,
      allowedTools: skill.allowedTools,
      userInvocable: skill.userInvocable !== false,
      model: skill.model,
      context: skill.context,
      agent: skill.agent,
      filePath: skill.filePath,
      category: deriveCategory(skill.filePath),
      content: skill.content,
    };

    return successResponse(response);
  } catch (error) {
    return errorResponse(error);
  }
});

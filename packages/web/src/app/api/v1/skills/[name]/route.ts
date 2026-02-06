import { NextRequest } from 'next/server';
import { withApiKeyAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError } from '@/lib/api/errors';
import { SkillLoader } from '@hasna/assistants-core';
import { join, basename } from 'path';
import { homedir } from 'os';

/**
 * Skill detail response for API
 * Note: filePath is intentionally not exposed to avoid leaking server paths
 */
interface SkillDetailResponse {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  userInvocable: boolean;
  model?: string;
  context?: string;
  assistant?: string;
  category: string;
  /** Safe source identifier (e.g., "shared/skill-name") */
  sourceId: string;
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
 * Get project skills directory path
 */
function getProjectSkillsDir(cwd: string): string {
  return join(cwd, '.assistants', 'skills');
}

/**
 * Derive category from file path
 * Normalizes path separators for cross-platform support (Windows uses \)
 */
function deriveCategory(filePath: string): string {
  // Normalize path separators for consistent checks
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (normalizedPath.includes('shared/skills')) {
    return 'shared';
  }
  if (normalizedPath.includes('.assistants/skills')) {
    return 'project';
  }
  return 'other';
}

/**
 * Generate a safe source identifier from file path
 * Format: "category/filename" (without extension)
 */
function generateSourceId(filePath: string, category: string): string {
  // Extract filename without extension
  const filename = basename(filePath).replace(/\.md$/i, '');
  return `${category}/${filename}`;
}

// GET /api/v1/skills/[name] - Get skill detail by name
// Supports both session auth and API key auth
export const GET = withApiKeyAuth(async (
  request: AuthenticatedRequest,
  { params }: { params: Promise<{ name: string }> }
) => {
  try {
    const { name } = await params;
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get('cwd'); // Optional project directory

    // Create a skill loader and load skills with content
    const skillLoader = new SkillLoader();

    // Load global skills first
    await skillLoader.loadFromDirectory(getGlobalSkillsDir(), { includeContent: true });

    // Load project-specific skills if cwd is provided (may override global)
    if (cwd && cwd.trim()) {
      await skillLoader.loadFromDirectory(getProjectSkillsDir(cwd), { includeContent: true });
    }

    // Find the skill by name
    const skill = skillLoader.getSkill(name);

    if (!skill) {
      throw new NotFoundError(`Skill '${name}' not found`);
    }

    const category = deriveCategory(skill.filePath);
    const response: SkillDetailResponse = {
      name: skill.name,
      description: skill.description,
      argumentHint: skill.argumentHint,
      allowedTools: skill.allowedTools,
      userInvocable: skill.userInvocable !== false,
      model: skill.model,
      context: skill.context,
      assistant: skill.assistant,
      category,
      sourceId: generateSourceId(skill.filePath, category),
      content: skill.content,
    };

    return successResponse(response);
  } catch (error) {
    return errorResponse(error);
  }
});

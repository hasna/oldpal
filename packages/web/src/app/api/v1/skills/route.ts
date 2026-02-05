import { NextRequest } from 'next/server';
import { withApiKeyAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { SkillLoader } from '@hasna/assistants-core';
import type { Skill } from '@hasna/assistants-shared';
import { join, basename } from 'path';
import { homedir } from 'os';

/**
 * Skill metadata returned by the API
 * Note: filePath is intentionally not exposed to avoid leaking server paths
 */
interface SkillMetadata {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  userInvocable: boolean;
  category: string;
  /** Safe source identifier (e.g., "shared/skill-name" or "project/skill-name") */
  sourceId: string;
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

/**
 * Generate a safe source identifier from file path
 * Format: "category/filename" (without extension)
 */
function generateSourceId(filePath: string, category: string): string {
  // Extract filename without extension
  const filename = basename(filePath).replace(/\.md$/i, '');
  return `${category}/${filename}`;
}

/**
 * Convert Skill to SkillMetadata
 * Note: filePath is intentionally not exposed to avoid server path leakage
 */
function toSkillMetadata(skill: Skill): SkillMetadata {
  const category = deriveCategory(skill.filePath);
  return {
    name: skill.name,
    description: skill.description || '',
    argumentHint: skill.argumentHint,
    allowedTools: skill.allowedTools,
    userInvocable: skill.userInvocable !== false,
    category,
    sourceId: generateSourceId(skill.filePath, category),
  };
}

// GET /api/v1/skills - List available skills with pagination and filtering
export const GET = withApiKeyAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);

    // Pagination params (handle invalid/NaN values with fallback)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));

    // Filter params
    const search = searchParams.get('search')?.toLowerCase();
    const category = searchParams.get('category');
    const userInvocableOnly = searchParams.get('userInvocableOnly') === 'true';

    // Sort params
    const sortBy = searchParams.get('sortBy') || 'name';
    const sortDir = searchParams.get('sortDir') || 'asc';

    // Create a skill loader and load user's global skills
    const skillLoader = new SkillLoader();

    // Load skills without content (just metadata)
    await skillLoader.loadFromDirectory(getGlobalSkillsDir(), { includeContent: false });

    // Get all loaded skills and convert to metadata format
    const allSkills = skillLoader.getSkills();
    let filteredSkills = allSkills.map(toSkillMetadata);

    // Filter by search
    if (search) {
      filteredSkills = filteredSkills.filter(
        (skill) =>
          skill.name.toLowerCase().includes(search) ||
          skill.description.toLowerCase().includes(search)
      );
    }

    // Filter by category
    if (category) {
      filteredSkills = filteredSkills.filter((skill) => skill.category === category);
    }

    // Filter by user-invocable
    if (userInvocableOnly) {
      filteredSkills = filteredSkills.filter((skill) => skill.userInvocable);
    }

    // Sort skills
    filteredSkills.sort((a, b) => {
      let aValue: string;
      let bValue: string;

      switch (sortBy) {
        case 'category':
          aValue = a.category;
          bValue = b.category;
          break;
        default:
          aValue = a.name;
          bValue = b.name;
      }

      const comparison = aValue.localeCompare(bValue);
      return sortDir === 'desc' ? -comparison : comparison;
    });

    // Get unique categories
    const categories = [...new Set(allSkills.map((s) => deriveCategory(s.filePath)))].sort();

    // Paginate
    const total = filteredSkills.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedSkills = filteredSkills.slice(offset, offset + limit);

    return successResponse({
      items: paginatedSkills,
      total,
      page,
      limit,
      totalPages,
      categories,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

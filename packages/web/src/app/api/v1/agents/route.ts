import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { eq, desc, asc, count, and, ilike } from 'drizzle-orm';
import { getModelById } from '@hasna/assistants-shared';

// Allow URLs or relative paths starting with /uploads/
const avatarSchema = z
  .string()
  .refine(
    (val) => val.startsWith('/uploads/') || val.startsWith('http://') || val.startsWith('https://'),
    { message: 'Avatar must be a valid URL or a relative upload path' }
  )
  .optional()
  .nullable();

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  avatar: avatarSchema,
  model: z.string().max(100).default('claude-sonnet-4-20250514'),
  systemPrompt: z.string().optional(),
  settings: z.object({
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().positive().optional(),
    tools: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
  }).optional(),
});

// GET /api/v1/agents - List user agents
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;

    // Filter parameters
    const activeOnly = searchParams.get('active') === 'true';
    const search = searchParams.get('search')?.trim();
    const status = searchParams.get('status'); // 'active' | 'inactive' | 'all'

    // Sorting parameters
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortDir = searchParams.get('sortDir') || 'desc';

    // Validate sortBy to prevent SQL injection
    const validSortColumns = ['name', 'createdAt', 'updatedAt', 'model'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = sortDir === 'asc' ? asc : desc;

    // Build filter conditions
    const conditions = [eq(agents.userId, request.user.userId)];

    if (activeOnly || status === 'active') {
      conditions.push(eq(agents.isActive, true));
    } else if (status === 'inactive') {
      conditions.push(eq(agents.isActive, false));
    }

    if (search) {
      conditions.push(ilike(agents.name, `%${search}%`));
    }

    const whereClause = and(...conditions);

    // Build order by based on sort column
    const getOrderBy = () => {
      switch (sortColumn) {
        case 'name':
          return [sortDirection(agents.name)];
        case 'updatedAt':
          return [sortDirection(agents.updatedAt)];
        case 'model':
          return [sortDirection(agents.model)];
        case 'createdAt':
        default:
          return [sortDirection(agents.createdAt)];
      }
    };

    const [userAgents, [{ total }]] = await Promise.all([
      db.query.agents.findMany({
        where: whereClause,
        orderBy: getOrderBy(),
        limit,
        offset,
      }),
      db.select({ total: count() }).from(agents).where(whereClause),
    ]);

    return paginatedResponse(userAgents, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/agents - Create a new agent
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const body = await request.json();
    const data = createAgentSchema.parse(body);

    // Validate and clamp maxTokens against model's limit
    if (data.settings?.maxTokens !== undefined) {
      const model = getModelById(data.model);
      if (model && model.maxOutputTokens) {
        data.settings.maxTokens = Math.min(data.settings.maxTokens, model.maxOutputTokens);
      }
    }

    const [newAgent] = await db
      .insert(agents)
      .values({
        userId: request.user.userId,
        name: data.name,
        description: data.description,
        avatar: data.avatar,
        model: data.model,
        systemPrompt: data.systemPrompt,
        settings: data.settings,
      })
      .returning();

    return successResponse(newAgent, 201);
  } catch (error) {
    return errorResponse(error);
  }
});

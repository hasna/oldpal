import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { eq, desc, count, and } from 'drizzle-orm';

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  avatar: z.string().url().optional(),
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
    const activeOnly = searchParams.get('active') === 'true';

    const whereClause = activeOnly
      ? and(eq(agents.userId, request.user.userId), eq(agents.isActive, true))
      : eq(agents.userId, request.user.userId);

    const [userAgents, [{ total }]] = await Promise.all([
      db.query.agents.findMany({
        where: whereClause,
        orderBy: [desc(agents.updatedAt)],
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

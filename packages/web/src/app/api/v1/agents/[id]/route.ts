import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError } from '@/lib/api/errors';
import { eq } from 'drizzle-orm';

const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  model: z.string().max(100).optional(),
  systemPrompt: z.string().optional().nullable(),
  settings: z.object({
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().positive().optional(),
    tools: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
  }).optional(),
  isActive: z.boolean().optional(),
});

// GET /api/v1/agents/:id - Get an agent
export const GET = withAuth(async (request: AuthenticatedRequest, { params }: { params: { id: string } }) => {
  try {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, params.id),
    });

    if (!agent) {
      return errorResponse(new NotFoundError('Agent not found'));
    }

    if (agent.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    return successResponse(agent);
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/agents/:id - Update an agent
export const PATCH = withAuth(async (request: AuthenticatedRequest, { params }: { params: { id: string } }) => {
  try {
    const body = await request.json();
    const data = updateAgentSchema.parse(body);

    // Check ownership
    const existingAgent = await db.query.agents.findFirst({
      where: eq(agents.id, params.id),
    });

    if (!existingAgent) {
      return errorResponse(new NotFoundError('Agent not found'));
    }

    if (existingAgent.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    const [updatedAgent] = await db
      .update(agents)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, params.id))
      .returning();

    return successResponse(updatedAgent);
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/agents/:id - Delete an agent
export const DELETE = withAuth(async (request: AuthenticatedRequest, { params }: { params: { id: string } }) => {
  try {
    // Check ownership
    const existingAgent = await db.query.agents.findFirst({
      where: eq(agents.id, params.id),
    });

    if (!existingAgent) {
      return errorResponse(new NotFoundError('Agent not found'));
    }

    if (existingAgent.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    await db.delete(agents).where(eq(agents.id, params.id));

    return successResponse({ message: 'Agent deleted' });
  } catch (error) {
    return errorResponse(error);
  }
});

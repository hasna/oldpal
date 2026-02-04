import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { eq } from 'drizzle-orm';

// Allow URLs or relative paths starting with /uploads/
const avatarSchema = z
  .string()
  .refine(
    (val) => val.startsWith('/uploads/') || val.startsWith('http://') || val.startsWith('https://'),
    { message: 'Avatar must be a valid URL or a relative upload path' }
  )
  .optional()
  .nullable();

const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  avatar: avatarSchema,
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

async function resolveParams(
  context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }
): Promise<Record<string, string> | undefined> {
  if (!context?.params) return undefined;
  const params = await Promise.resolve(context.params as Record<string, string>);
  return params;
}

// GET /api/v1/agents/:id - Get an agent
export const GET = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing agent id'));
    }
    validateUUID(id, 'agent id');

    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, id),
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
export const PATCH = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing agent id'));
    }
    validateUUID(id, 'agent id');

    const body = await request.json();
    const data = updateAgentSchema.parse(body);

    // Check ownership
    const existingAgent = await db.query.agents.findFirst({
      where: eq(agents.id, id),
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
      .where(eq(agents.id, id))
      .returning();

    return successResponse(updatedAgent);
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/agents/:id - Delete an agent
export const DELETE = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing agent id'));
    }
    validateUUID(id, 'agent id');

    // Check ownership
    const existingAgent = await db.query.agents.findFirst({
      where: eq(agents.id, id),
    });

    if (!existingAgent) {
      return errorResponse(new NotFoundError('Agent not found'));
    }

    if (existingAgent.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    await db.delete(agents).where(eq(agents.id, id));

    return successResponse({ message: 'Agent deleted' });
  } catch (error) {
    return errorResponse(error);
  }
});

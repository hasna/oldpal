import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { assistants } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { eq } from 'drizzle-orm';
import { getModelById, clampMaxTokens } from '@hasna/assistants-shared';

// Allow URLs or relative paths starting with /uploads/
const avatarSchema = z
  .string()
  .refine(
    (val) => val.startsWith('/uploads/') || val.startsWith('http://') || val.startsWith('https://'),
    { message: 'Avatar must be a valid URL or a relative upload path' }
  )
  .optional()
  .nullable();

const updateAssistantSchema = z.object({
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

// GET /api/v1/assistants/:id - Get an assistant
export const GET = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing assistant id'));
    }
    validateUUID(id, 'assistant id');

    const assistant = await db.query.assistants.findFirst({
      where: eq(assistants.id, id),
    });

    if (!assistant) {
      return errorResponse(new NotFoundError('Assistant not found'));
    }

    if (assistant.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    return successResponse(assistant);
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/assistants/:id - Update an assistant
export const PATCH = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing assistant id'));
    }
    validateUUID(id, 'assistant id');

    const body = await request.json();
    const data = updateAssistantSchema.parse(body);

    // Validate and clamp maxTokens against model's limit
    if (data.settings?.maxTokens !== undefined && data.model) {
      const model = getModelById(data.model);
      if (model && model.maxOutputTokens) {
        data.settings.maxTokens = Math.min(data.settings.maxTokens, model.maxOutputTokens);
      }
    }

    // Check ownership
    const existingAssistant = await db.query.assistants.findFirst({
      where: eq(assistants.id, id),
    });

    if (!existingAssistant) {
      return errorResponse(new NotFoundError('Assistant not found'));
    }

    if (existingAssistant.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    const [updatedAssistant] = await db
      .update(assistants)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(assistants.id, id))
      .returning();

    return successResponse(updatedAssistant);
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/assistants/:id - Delete an assistant
export const DELETE = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing assistant id'));
    }
    validateUUID(id, 'assistant id');

    // Check ownership
    const existingAssistant = await db.query.assistants.findFirst({
      where: eq(assistants.id, id),
    });

    if (!existingAssistant) {
      return errorResponse(new NotFoundError('Assistant not found'));
    }

    if (existingAssistant.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    await db.delete(assistants).where(eq(assistants.id, id));

    return successResponse({ message: 'Assistant deleted' });
  } catch (error) {
    return errorResponse(error);
  }
});

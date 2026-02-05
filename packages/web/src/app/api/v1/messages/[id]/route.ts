import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { agentMessages, assistants } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { eq, or } from 'drizzle-orm';

const updateMessageSchema = z.object({
  status: z.enum(['unread', 'read', 'archived', 'injected']).optional(),
});

async function resolveParams(
  context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }
): Promise<Record<string, string> | undefined> {
  if (!context?.params) return undefined;
  const params = await Promise.resolve(context.params as Record<string, string>);
  return params;
}

// GET /api/v1/messages/:id - Get a message
export const GET = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing message id'));
    }
    validateUUID(id, 'message id');

    const message = await db.query.agentMessages.findFirst({
      where: eq(agentMessages.id, id),
    });

    if (!message) {
      return errorResponse(new NotFoundError('Message not found'));
    }

    // Verify user owns either the sender or recipient agent
    const userAgents = await db.query.assistants.findMany({
      where: eq(assistants.userId, request.user.userId),
      columns: { id: true },
    });

    const agentIds = userAgents.map((a) => a.id);
    const hasAccess =
      (message.fromAgentId && agentIds.includes(message.fromAgentId)) ||
      (message.toAgentId && agentIds.includes(message.toAgentId));

    if (!hasAccess) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    return successResponse(message);
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/messages/:id - Update message status
export const PATCH = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing message id'));
    }
    validateUUID(id, 'message id');

    const body = await request.json();
    const data = updateMessageSchema.parse(body);

    // Reject empty updates
    if (!data.status) {
      return errorResponse(new BadRequestError('No updatable fields provided'));
    }

    const message = await db.query.agentMessages.findFirst({
      where: eq(agentMessages.id, id),
    });

    if (!message) {
      return errorResponse(new NotFoundError('Message not found'));
    }

    // Verify user owns either the sender or recipient agent
    const userAgents = await db.query.assistants.findMany({
      where: eq(assistants.userId, request.user.userId),
      columns: { id: true },
    });

    const agentIds = userAgents.map((a) => a.id);
    const hasAccess =
      (message.fromAgentId && agentIds.includes(message.fromAgentId)) ||
      (message.toAgentId && agentIds.includes(message.toAgentId));

    if (!hasAccess) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    const updateData: Record<string, unknown> = {};

    if (data.status) {
      updateData.status = data.status;
      if (data.status === 'read' && !message.readAt) {
        updateData.readAt = new Date();
      }
      if (data.status === 'injected' && !message.injectedAt) {
        updateData.injectedAt = new Date();
      }
    }

    const [updatedMessage] = await db
      .update(agentMessages)
      .set(updateData)
      .where(eq(agentMessages.id, id))
      .returning();

    return successResponse(updatedMessage);
  } catch (error) {
    return errorResponse(error);
  }
});

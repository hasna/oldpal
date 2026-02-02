import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { agentMessages, agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError } from '@/lib/api/errors';
import { eq, or } from 'drizzle-orm';

const updateMessageSchema = z.object({
  status: z.enum(['unread', 'read', 'archived', 'injected']).optional(),
});

// GET /api/v1/messages/:id - Get a message
export const GET = withAuth(async (request: AuthenticatedRequest, { params }: { params: { id: string } }) => {
  try {
    const message = await db.query.agentMessages.findFirst({
      where: eq(agentMessages.id, params.id),
    });

    if (!message) {
      return errorResponse(new NotFoundError('Message not found'));
    }

    // Verify user owns either the sender or recipient agent
    const userAgents = await db.query.agents.findMany({
      where: eq(agents.userId, request.user.userId),
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
export const PATCH = withAuth(async (request: AuthenticatedRequest, { params }: { params: { id: string } }) => {
  try {
    const body = await request.json();
    const data = updateMessageSchema.parse(body);

    const message = await db.query.agentMessages.findFirst({
      where: eq(agentMessages.id, params.id),
    });

    if (!message) {
      return errorResponse(new NotFoundError('Message not found'));
    }

    // Verify user owns the recipient agent
    if (message.toAgentId) {
      const recipientAgent = await db.query.agents.findFirst({
        where: eq(agents.id, message.toAgentId),
      });

      if (!recipientAgent || recipientAgent.userId !== request.user.userId) {
        return errorResponse(new ForbiddenError('Access denied'));
      }
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
      .where(eq(agentMessages.id, params.id))
      .returning();

    return successResponse(updatedMessage);
  } catch (error) {
    return errorResponse(error);
  }
});

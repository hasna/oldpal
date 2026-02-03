import { NextRequest } from 'next/server';
import { db } from '@/db';
import { agentMessages, agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { ForbiddenError, BadRequestError } from '@/lib/api/errors';
import { eq, asc, or } from 'drizzle-orm';

async function resolveParams(
  context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }
): Promise<Record<string, string> | undefined> {
  if (!context?.params) return undefined;
  const params = await Promise.resolve(context.params as Record<string, string>);
  return params;
}

// GET /api/v1/messages/threads/:threadId - Get all messages in a thread
export const GET = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const threadId = params?.threadId;
    if (!threadId) {
      return errorResponse(new BadRequestError('Missing thread id'));
    }

    // Get user's agents
    const userAgents = await db.query.agents.findMany({
      where: eq(agents.userId, request.user.userId),
      columns: { id: true },
    });

    const agentIds = userAgents.map((a) => a.id);

    if (agentIds.length === 0) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    // Get all messages in the thread
    const threadMessages = await db.query.agentMessages.findMany({
      where: eq(agentMessages.threadId, threadId),
      orderBy: [asc(agentMessages.createdAt)],
    });

    // Verify user has access to at least one message in the thread
    const hasAccess = threadMessages.some((msg) => {
      return (
        (msg.fromAgentId && agentIds.includes(msg.fromAgentId)) ||
        (msg.toAgentId && agentIds.includes(msg.toAgentId))
      );
    });

    if (!hasAccess && threadMessages.length > 0) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    return successResponse({
      threadId,
      messages: threadMessages,
      count: threadMessages.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { agentMessages, agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/lib/api/errors';
import { eq, desc, count, and, or, isNull } from 'drizzle-orm';

const createMessageSchema = z.object({
  toAgentId: z.string().uuid(),
  fromAgentId: z.string().uuid().optional(),
  subject: z.string().max(500).optional(),
  body: z.string().min(1),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  threadId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
});

// GET /api/v1/messages - List agent messages (inbox)
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;
    const status = searchParams.get('status') as 'unread' | 'read' | 'archived' | null;
    const agentId = searchParams.get('agentId');

    // Get user's agents
    const userAgents = await db.query.agents.findMany({
      where: eq(agents.userId, request.user.userId),
      columns: { id: true },
    });

    const agentIds = userAgents.map((a) => a.id);

    if (agentIds.length === 0) {
      return paginatedResponse([], 0, page, limit);
    }

    // Build where clause
    let whereClause = or(...agentIds.map((id) => eq(agentMessages.toAgentId, id)));

    if (agentId && agentIds.includes(agentId)) {
      whereClause = eq(agentMessages.toAgentId, agentId);
    }

    if (status) {
      whereClause = and(whereClause, eq(agentMessages.status, status));
    }

    const [messagesList, [{ total }]] = await Promise.all([
      db.query.agentMessages.findMany({
        where: whereClause,
        orderBy: [desc(agentMessages.createdAt)],
        limit,
        offset,
      }),
      db.select({ total: count() }).from(agentMessages).where(whereClause!),
    ]);

    return paginatedResponse(messagesList, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/messages - Send a message
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const body = await request.json();
    const data = createMessageSchema.parse(body);

    // Verify sender agent ownership (if specified)
    if (data.fromAgentId) {
      const fromAgent = await db.query.agents.findFirst({
        where: eq(agents.id, data.fromAgentId),
      });

      if (!fromAgent || fromAgent.userId !== request.user.userId) {
        return errorResponse(new ForbiddenError('You do not own the sender agent'));
      }
    }

    // Verify recipient agent exists
    const toAgent = await db.query.agents.findFirst({
      where: eq(agents.id, data.toAgentId),
    });

    if (!toAgent) {
      return errorResponse(new NotFoundError('Recipient agent not found'));
    }

    // Generate thread ID if not provided
    const threadId = data.threadId || randomUUID();

    const [newMessage] = await db
      .insert(agentMessages)
      .values({
        threadId,
        parentId: data.parentId,
        fromAgentId: data.fromAgentId,
        toAgentId: data.toAgentId,
        subject: data.subject,
        body: data.body,
        priority: data.priority,
      })
      .returning();

    return successResponse(newMessage, 201);
  } catch (error) {
    return errorResponse(error);
  }
});

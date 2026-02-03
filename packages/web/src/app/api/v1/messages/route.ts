import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { agentMessages, agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, isValidUUID } from '@/lib/api/errors';
import { eq, desc, count, and, or, isNull } from 'drizzle-orm';

// Max body length: 50KB to prevent DB abuse
const MAX_BODY_LENGTH = 50_000;

const createMessageSchema = z.object({
  toAgentId: z.string().uuid(),
  fromAgentId: z.string().uuid().optional(),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(MAX_BODY_LENGTH, `Body must be at most ${MAX_BODY_LENGTH} characters`),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  threadId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
});

// Valid status values for messages
const VALID_STATUSES = ['unread', 'read', 'archived', 'injected'] as const;
type MessageStatus = (typeof VALID_STATUSES)[number];

// GET /api/v1/messages - List agent messages (inbox)
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;
    const statusParam = searchParams.get('status');
    const agentId = searchParams.get('agentId');

    // Validate status if provided
    let status: MessageStatus | null = null;
    if (statusParam) {
      if (!VALID_STATUSES.includes(statusParam as MessageStatus)) {
        return errorResponse(new BadRequestError(`Invalid status: must be one of ${VALID_STATUSES.join(', ')}`));
      }
      status = statusParam as MessageStatus;
    }

    // Validate agentId as UUID if provided
    if (agentId && !isValidUUID(agentId)) {
      return errorResponse(new BadRequestError('Invalid agentId: must be a valid UUID'));
    }

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

    // Verify recipient agent exists and user owns it
    const toAgent = await db.query.agents.findFirst({
      where: eq(agents.id, data.toAgentId),
    });

    if (!toAgent) {
      return errorResponse(new NotFoundError('Recipient agent not found'));
    }

    if (toAgent.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('You do not own the recipient agent'));
    }

    // Get all user's agents for ownership checks
    const userAgents = await db.query.agents.findMany({
      where: eq(agents.userId, request.user.userId),
      columns: { id: true },
    });
    const agentIds = userAgents.map((a) => a.id);

    // Validate parentId ownership if provided
    if (data.parentId) {
      const parentMessage = await db.query.agentMessages.findFirst({
        where: eq(agentMessages.id, data.parentId),
      });

      if (!parentMessage) {
        return errorResponse(new NotFoundError('Parent message not found'));
      }

      // Verify user owns either sender or recipient of parent message
      const hasParentAccess =
        (parentMessage.fromAgentId && agentIds.includes(parentMessage.fromAgentId)) ||
        (parentMessage.toAgentId && agentIds.includes(parentMessage.toAgentId));

      if (!hasParentAccess) {
        return errorResponse(new ForbiddenError('Access denied to parent message'));
      }

      // If threadId is also provided, verify it matches the parent's threadId
      if (data.threadId && data.threadId !== parentMessage.threadId) {
        return errorResponse(new BadRequestError('Thread ID does not match parent message thread'));
      }
    }

    // Validate threadId ownership if provided (and no parentId)
    if (data.threadId && !data.parentId) {
      const existingThreadMessage = await db.query.agentMessages.findFirst({
        where: eq(agentMessages.threadId, data.threadId),
      });

      if (existingThreadMessage) {
        // Thread exists - verify user owns at least one agent in the thread
        const hasThreadAccess =
          (existingThreadMessage.fromAgentId && agentIds.includes(existingThreadMessage.fromAgentId)) ||
          (existingThreadMessage.toAgentId && agentIds.includes(existingThreadMessage.toAgentId));

        if (!hasThreadAccess) {
          return errorResponse(new ForbiddenError('Access denied to thread'));
        }
      }
      // If thread doesn't exist yet, it's OK to create a new one with the provided threadId
    }

    // Generate thread ID if not provided
    const threadId = data.threadId || (data.parentId
      ? (await db.query.agentMessages.findFirst({ where: eq(agentMessages.id, data.parentId) }))?.threadId
      : null) || crypto.randomUUID();

    const [newMessage] = await db
      .insert(agentMessages)
      .values({
        threadId,
        parentId: data.parentId || null,
        fromAgentId: data.fromAgentId || null,
        toAgentId: data.toAgentId,
        subject: data.subject || null,
        body: data.body,
        priority: data.priority,
      })
      .returning();

    return successResponse(newMessage, 201);
  } catch (error) {
    return errorResponse(error);
  }
});

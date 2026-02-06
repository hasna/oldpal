import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { assistantMessages, assistants } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, isValidUUID } from '@/lib/api/errors';
import { eq, desc, asc, count, and, or, isNull, ilike } from 'drizzle-orm';

// Max body length: 50KB to prevent DB abuse
const MAX_BODY_LENGTH = 50_000;

const createMessageSchema = z.object({
  toAssistantId: z.string().uuid(),
  fromAssistantId: z.string().uuid().optional(),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(MAX_BODY_LENGTH, `Body must be at most ${MAX_BODY_LENGTH} characters`),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  threadId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
});

// Valid status values for messages
const VALID_STATUSES = ['unread', 'read', 'archived', 'injected'] as const;
type MessageStatus = (typeof VALID_STATUSES)[number];

// GET /api/v1/messages - List assistant messages (inbox)
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
    const assistantId = searchParams.get('assistantId');
    const priorityParam = searchParams.get('priority');
    const search = searchParams.get('search')?.trim();

    // Sorting parameters
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortDir = searchParams.get('sortDir') || 'desc';

    // Validate sortBy to prevent SQL injection
    const validSortColumns = ['subject', 'createdAt', 'priority', 'status'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = sortDir === 'asc' ? asc : desc;

    // Validate status if provided
    let status: MessageStatus | null = null;
    if (statusParam) {
      if (!VALID_STATUSES.includes(statusParam as MessageStatus)) {
        return errorResponse(new BadRequestError(`Invalid status: must be one of ${VALID_STATUSES.join(', ')}`));
      }
      status = statusParam as MessageStatus;
    }

    // Validate priority if provided
    const validPriorities = ['low', 'normal', 'high', 'urgent'] as const;
    type MessagePriority = (typeof validPriorities)[number];
    let priority: MessagePriority | null = null;
    if (priorityParam && validPriorities.includes(priorityParam as MessagePriority)) {
      priority = priorityParam as MessagePriority;
    }

    // Validate assistantId as UUID if provided
    if (assistantId && !isValidUUID(assistantId)) {
      return errorResponse(new BadRequestError('Invalid assistantId: must be a valid UUID'));
    }

    // Get user's assistants
    const userAssistants = await db.query.assistants.findMany({
      where: eq(assistants.userId, request.user.userId),
      columns: { id: true },
    });

    const assistantIds = userAssistants.map((a) => a.id);

    if (assistantIds.length === 0) {
      return paginatedResponse([], 0, page, limit);
    }

    // Build where clause conditions
    const conditions = [];

    // Base filter: messages to user's assistants
    if (assistantId && assistantIds.includes(assistantId)) {
      conditions.push(eq(assistantMessages.toAssistantId, assistantId));
    } else {
      conditions.push(or(...assistantIds.map((id) => eq(assistantMessages.toAssistantId, id))));
    }

    if (status) {
      conditions.push(eq(assistantMessages.status, status));
    }

    if (priority) {
      conditions.push(eq(assistantMessages.priority, priority));
    }

    if (search) {
      conditions.push(
        or(
          ilike(assistantMessages.subject, `%${search}%`),
          ilike(assistantMessages.body, `%${search}%`)
        )
      );
    }

    const whereClause = and(...conditions);

    // Build order by based on sort column
    const getOrderBy = () => {
      switch (sortColumn) {
        case 'subject':
          return [sortDirection(assistantMessages.subject)];
        case 'priority':
          return [sortDirection(assistantMessages.priority)];
        case 'status':
          return [sortDirection(assistantMessages.status)];
        case 'createdAt':
        default:
          return [sortDirection(assistantMessages.createdAt)];
      }
    };

    const [messagesList, [{ total }]] = await Promise.all([
      db.query.assistantMessages.findMany({
        where: whereClause,
        orderBy: getOrderBy(),
        limit,
        offset,
      }),
      db.select({ total: count() }).from(assistantMessages).where(whereClause!),
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

    // Verify sender assistant ownership (if specified)
    if (data.fromAssistantId) {
      const fromAssistant = await db.query.assistants.findFirst({
        where: eq(assistants.id, data.fromAssistantId),
      });

      if (!fromAssistant || fromAssistant.userId !== request.user.userId) {
        return errorResponse(new ForbiddenError('You do not own the sender assistant'));
      }
    }

    // Verify recipient assistant exists and user owns it
    const toAssistant = await db.query.assistants.findFirst({
      where: eq(assistants.id, data.toAssistantId),
    });

    if (!toAssistant) {
      return errorResponse(new NotFoundError('Recipient assistant not found'));
    }

    if (toAssistant.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('You do not own the recipient assistant'));
    }

    // Get all user's assistants for ownership checks
    const userAssistants = await db.query.assistants.findMany({
      where: eq(assistants.userId, request.user.userId),
      columns: { id: true },
    });
    const assistantIds = userAssistants.map((a) => a.id);

    // Validate parentId ownership if provided
    if (data.parentId) {
      const parentMessage = await db.query.assistantMessages.findFirst({
        where: eq(assistantMessages.id, data.parentId),
      });

      if (!parentMessage) {
        return errorResponse(new NotFoundError('Parent message not found'));
      }

      // Verify user owns either sender or recipient of parent message
      const hasParentAccess =
        (parentMessage.fromAssistantId && assistantIds.includes(parentMessage.fromAssistantId)) ||
        (parentMessage.toAssistantId && assistantIds.includes(parentMessage.toAssistantId));

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
      const existingThreadMessage = await db.query.assistantMessages.findFirst({
        where: eq(assistantMessages.threadId, data.threadId),
      });

      if (existingThreadMessage) {
        // Thread exists - verify user owns at least one assistant in the thread
        const hasThreadAccess =
          (existingThreadMessage.fromAssistantId && assistantIds.includes(existingThreadMessage.fromAssistantId)) ||
          (existingThreadMessage.toAssistantId && assistantIds.includes(existingThreadMessage.toAssistantId));

        if (!hasThreadAccess) {
          return errorResponse(new ForbiddenError('Access denied to thread'));
        }
      }
      // If thread doesn't exist yet, it's OK to create a new one with the provided threadId
    }

    // Generate thread ID if not provided
    const threadId = data.threadId || (data.parentId
      ? (await db.query.assistantMessages.findFirst({ where: eq(assistantMessages.id, data.parentId) }))?.threadId
      : null) || crypto.randomUUID();

    const [newMessage] = await db
      .insert(assistantMessages)
      .values({
        threadId,
        parentId: data.parentId || null,
        fromAssistantId: data.fromAssistantId || null,
        toAssistantId: data.toAssistantId,
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

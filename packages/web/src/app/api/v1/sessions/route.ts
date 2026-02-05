import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { sessions, messages } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { assistants } from '@/db/schema';
import { eq, desc, asc, count, and, or, ilike, gte, lte, inArray, sql } from 'drizzle-orm';

const createSessionSchema = z.object({
  label: z.string().max(255).optional(),
  cwd: z.string().optional(),
  agentId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/v1/sessions - List user sessions with search and filtering
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;

    // Search and filter parameters
    const search = searchParams.get('search')?.trim();
    const agentId = searchParams.get('agentId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Sorting parameters
    const sortBy = searchParams.get('sortBy') || 'updatedAt';
    const sortDir = searchParams.get('sortDir') || 'desc';

    // Validate sortBy to prevent SQL injection
    const validSortColumns = ['label', 'createdAt', 'updatedAt'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'updatedAt';
    const sortDirection = sortDir === 'asc' ? asc : desc;

    // Build filter conditions
    const conditions = [eq(sessions.userId, request.user.userId)];

    // Filter by agent
    if (agentId) {
      conditions.push(eq(sessions.agentId, agentId));
    }

    // Filter by date range
    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start.getTime())) {
        conditions.push(gte(sessions.createdAt, start));
      }
    }
    if (endDate) {
      const end = new Date(endDate);
      if (!isNaN(end.getTime())) {
        // Set to end of day
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(sessions.createdAt, end));
      }
    }

    // Search by label or message content
    let sessionIdsFromSearch: string[] | null = null;
    if (search) {
      // First, find sessions matching by label
      const labelMatchingSessions = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.userId, request.user.userId), ilike(sessions.label, `%${search}%`)));

      // Find sessions with matching message content
      const messageMatchingSessions = await db
        .selectDistinct({ sessionId: messages.sessionId })
        .from(messages)
        .innerJoin(sessions, eq(messages.sessionId, sessions.id))
        .where(
          and(
            eq(sessions.userId, request.user.userId),
            ilike(messages.content, `%${search}%`)
          )
        );

      // Combine unique session IDs
      const matchingIds = new Set([
        ...labelMatchingSessions.map((s) => s.id),
        ...messageMatchingSessions.map((m) => m.sessionId),
      ]);
      sessionIdsFromSearch = Array.from(matchingIds);

      // If no matches found, return empty result
      if (sessionIdsFromSearch.length === 0) {
        return paginatedResponse([], 0, page, limit);
      }

      conditions.push(inArray(sessions.id, sessionIdsFromSearch));
    }

    const whereClause = and(...conditions);

    // Build order by based on sort column
    const getOrderBy = () => {
      switch (sortColumn) {
        case 'label':
          return [sortDirection(sessions.label)];
        case 'createdAt':
          return [sortDirection(sessions.createdAt)];
        case 'updatedAt':
        default:
          return [sortDirection(sessions.updatedAt)];
      }
    };

    const [userSessions, [{ total }]] = await Promise.all([
      db.query.sessions.findMany({
        where: whereClause,
        orderBy: getOrderBy(),
        limit,
        offset,
        with: {
          agent: {
            columns: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      }),
      db.select({ total: count() }).from(sessions).where(whereClause),
    ]);

    return paginatedResponse(userSessions, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/sessions - Create a new session
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const body = await request.json();
    const data = createSessionSchema.parse(body);

    // Verify agent ownership if agentId is provided
    if (data.agentId) {
      const agent = await db.query.assistants.findFirst({
        where: eq(assistants.id, data.agentId),
      });

      if (!agent) {
        return errorResponse(new NotFoundError('Agent not found'));
      }

      if (agent.userId !== request.user.userId) {
        return errorResponse(new ForbiddenError('You do not own this agent'));
      }
    }

    const [newSession] = await db
      .insert(sessions)
      .values({
        userId: request.user.userId,
        label: data.label,
        cwd: data.cwd,
        agentId: data.agentId,
        metadata: data.metadata,
      })
      .returning();

    return successResponse(newSession, 201);
  } catch (error) {
    return errorResponse(error);
  }
});

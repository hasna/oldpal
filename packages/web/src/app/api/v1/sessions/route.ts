import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { agents } from '@/db/schema';
import { eq, desc, count } from 'drizzle-orm';

const createSessionSchema = z.object({
  label: z.string().max(255).optional(),
  cwd: z.string().optional(),
  agentId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/v1/sessions - List user sessions
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;

    const [userSessions, [{ total }]] = await Promise.all([
      db.query.sessions.findMany({
        where: eq(sessions.userId, request.user.userId),
        orderBy: [desc(sessions.updatedAt)],
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
      db.select({ total: count() }).from(sessions).where(eq(sessions.userId, request.user.userId)),
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
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, data.agentId),
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

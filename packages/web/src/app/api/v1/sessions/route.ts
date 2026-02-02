import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
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

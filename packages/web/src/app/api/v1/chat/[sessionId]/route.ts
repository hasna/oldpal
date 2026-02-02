import { NextRequest } from 'next/server';
import { db } from '@/db';
import { sessions, messages } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError } from '@/lib/api/errors';
import { eq, asc, count, and } from 'drizzle-orm';

// GET /api/v1/chat/:sessionId - Get chat history for a session
export const GET = withAuth(async (request: AuthenticatedRequest, { params }: { params: { sessionId: string } }) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = (page - 1) * limit;

    // Verify session ownership
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, params.sessionId),
    });

    if (!session) {
      return errorResponse(new NotFoundError('Session not found'));
    }

    if (session.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    const [sessionMessages, [{ total }]] = await Promise.all([
      db.query.messages.findMany({
        where: eq(messages.sessionId, params.sessionId),
        orderBy: [asc(messages.createdAt)],
        limit,
        offset,
      }),
      db.select({ total: count() }).from(messages).where(eq(messages.sessionId, params.sessionId)),
    ]);

    return paginatedResponse(sessionMessages, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

import { NextRequest } from 'next/server';
import { db } from '@/db';
import { sessions, messages } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { eq, asc, count, and } from 'drizzle-orm';

async function resolveParams(
  context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }
): Promise<Record<string, string> | undefined> {
  if (!context?.params) return undefined;
  const params = await Promise.resolve(context.params as Record<string, string>);
  return params;
}

// GET /api/v1/chat/:sessionId - Get chat history for a session
export const GET = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const sessionId = params?.sessionId;
    if (!sessionId) {
      return errorResponse(new BadRequestError('Missing session id'));
    }
    validateUUID(sessionId, 'session id');

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '50', 10) || 50),
      100
    );
    const offset = (page - 1) * limit;

    // Verify session ownership
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      return errorResponse(new NotFoundError('Session not found'));
    }

    if (session.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    const [sessionMessages, [{ total }]] = await Promise.all([
      db.query.messages.findMany({
        where: eq(messages.sessionId, sessionId),
        orderBy: [asc(messages.createdAt)],
        limit,
        offset,
      }),
      db.select({ total: count() }).from(messages).where(eq(messages.sessionId, sessionId)),
    ]);

    return paginatedResponse(sessionMessages, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

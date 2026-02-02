import { NextRequest } from 'next/server';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError } from '@/lib/api/errors';
import { stopSession } from '@/lib/server/agent-pool';
import { eq } from 'drizzle-orm';

// POST /api/v1/chat/:sessionId/stop - Stop generation for a session
export const POST = withAuth(async (request: AuthenticatedRequest, { params }: { params: { sessionId: string } }) => {
  try {
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

    await stopSession(params.sessionId);

    return successResponse({ message: 'Generation stopped' });
  } catch (error) {
    return errorResponse(error);
  }
});

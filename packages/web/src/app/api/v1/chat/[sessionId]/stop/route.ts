import { NextRequest } from 'next/server';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { stopSession } from '@/lib/server/agent-pool';
import { eq } from 'drizzle-orm';

async function resolveParams(
  context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }
): Promise<Record<string, string> | undefined> {
  if (!context?.params) return undefined;
  const params = await Promise.resolve(context.params as Record<string, string>);
  return params;
}

// POST /api/v1/chat/:sessionId/stop - Stop generation for a session
export const POST = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const sessionId = params?.sessionId;
    if (!sessionId) {
      return errorResponse(new BadRequestError('Missing session id'));
    }
    validateUUID(sessionId, 'session id');

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

    await stopSession(sessionId);

    return successResponse({ message: 'Generation stopped' });
  } catch (error) {
    return errorResponse(error);
  }
});

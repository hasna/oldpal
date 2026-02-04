import { db } from '@/db';
import { refreshTokens } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError } from '@/lib/api/errors';
import { eq, and } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DELETE /api/v1/users/me/sessions/[id] - Logout a specific session
export const DELETE = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id: sessionId } = await params;
    const userId = request.user.userId;

    if (!UUID_REGEX.test(sessionId)) {
      return errorResponse(new NotFoundError('Session not found'));
    }

    // Verify the session belongs to this user
    const session = await db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.id, sessionId),
    });

    if (!session) {
      return errorResponse(new NotFoundError('Session not found'));
    }

    if (session.userId !== userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    if (session.revokedAt) {
      return errorResponse(new NotFoundError('Session already revoked'));
    }

    // Revoke the session
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, sessionId));

    return successResponse({
      success: true,
      message: 'Session has been logged out',
    });
  } catch (error) {
    return errorResponse(error);
  }
});

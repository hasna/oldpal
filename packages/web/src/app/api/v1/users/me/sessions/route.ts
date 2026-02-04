import { db } from '@/db';
import { refreshTokens } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { eq, and, isNull, desc } from 'drizzle-orm';

// GET /api/v1/users/me/sessions - Get user's active sessions
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;

    // Get all active (non-revoked, non-expired) refresh tokens
    const now = new Date();
    const sessions = await db.query.refreshTokens.findMany({
      where: and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt)
      ),
      orderBy: [desc(refreshTokens.createdAt)],
    });

    // Filter out expired tokens and format response
    const activeSessions = sessions
      .filter((session) => session.expiresAt > now)
      .map((session) => ({
        id: session.id,
        device: session.device || 'Unknown',
        browser: session.browser || 'Unknown',
        os: session.os || 'Unknown',
        ipAddress: session.ipAddress,
        lastUsedAt: session.lastUsedAt || session.createdAt,
        createdAt: session.createdAt,
        // Note: We can't know which session is "current" without the actual token
        // The frontend will need to identify this based on timing or other heuristics
      }));

    return successResponse({
      sessions: activeSessions,
      count: activeSessions.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/users/me/sessions - Logout all other sessions
export const DELETE = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;
    const { searchParams } = new URL(request.url);
    const keepCurrent = searchParams.get('keepCurrent') !== 'false';

    // Get current session's family from the refresh token (if we can identify it)
    // For now, we'll revoke all sessions - the user will need to re-login
    // In a more sophisticated implementation, we'd pass the current token family

    const now = new Date();

    // Revoke all tokens for this user
    await db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt)
        )
      );

    return successResponse({
      success: true,
      message: 'All sessions have been logged out',
    });
  } catch (error) {
    return errorResponse(error);
  }
});

import { db } from '@/db';
import { assistants, sessions, messages } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { eq, and, count, gte, sql } from 'drizzle-orm';

export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;

    // Count active assistants for user
    const assistantCountResult = await db
      .select({ count: count() })
      .from(assistants)
      .where(and(eq(assistants.userId, userId), eq(assistants.isActive, true)));

    const assistantCount = assistantCountResult[0]?.count ?? 0;

    // Count sessions for user
    const sessionCountResult = await db
      .select({ count: count() })
      .from(sessions)
      .where(eq(sessions.userId, userId));

    const sessionCount = sessionCountResult[0]?.count ?? 0;

    // Count messages for today (user role only, since that represents user actions)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const messageCountResult = await db
      .select({ count: count() })
      .from(messages)
      .innerJoin(sessions, eq(messages.sessionId, sessions.id))
      .where(
        and(
          eq(sessions.userId, userId),
          eq(messages.role, 'user'),
          gte(messages.createdAt, todayStart)
        )
      );

    const messageCount = messageCountResult[0]?.count ?? 0;

    return successResponse({
      assistants: assistantCount,
      sessions: sessionCount,
      messagestoday: messageCount,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

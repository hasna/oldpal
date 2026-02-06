import { NextRequest } from 'next/server';
import { db } from '@/db';
import { users, sessions, assistants, messages, assistantMessages } from '@/db/schema';
import { withAdminAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { count, sql, gte } from 'drizzle-orm';

// GET /api/v1/admin/stats - Get system statistics (admin only)
export const GET = withAdminAuth(async (request: AuthenticatedRequest) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      [{ totalUsers }],
      [{ totalSessions }],
      [{ totalAssistants }],
      [{ totalMessages }],
      [{ totalAssistantMessages }],
      [{ newUsersToday }],
      [{ newUsersWeek }],
      [{ newUsersMonth }],
      [{ sessionsToday }],
      [{ messagesWeek }],
    ] = await Promise.all([
      db.select({ totalUsers: count() }).from(users),
      db.select({ totalSessions: count() }).from(sessions),
      db.select({ totalAssistants: count() }).from(assistants),
      db.select({ totalMessages: count() }).from(messages),
      db.select({ totalAssistantMessages: count() }).from(assistantMessages),
      db.select({ newUsersToday: count() }).from(users).where(gte(users.createdAt, oneDayAgo)),
      db.select({ newUsersWeek: count() }).from(users).where(gte(users.createdAt, oneWeekAgo)),
      db.select({ newUsersMonth: count() }).from(users).where(gte(users.createdAt, oneMonthAgo)),
      db.select({ sessionsToday: count() }).from(sessions).where(gte(sessions.createdAt, oneDayAgo)),
      db.select({ messagesWeek: count() }).from(messages).where(gte(messages.createdAt, oneWeekAgo)),
    ]);

    return successResponse({
      totals: {
        users: totalUsers,
        sessions: totalSessions,
        assistants: totalAssistants,
        messages: totalMessages,
        assistantMessages: totalAssistantMessages,
      },
      recent: {
        newUsersToday,
        newUsersWeek,
        newUsersMonth,
        sessionsToday,
        messagesWeek,
      },
      generated: now.toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
});

import { NextRequest } from 'next/server';
import { db } from '@/db';
import { users, sessions, assistants, messages, agentMessages } from '@/db/schema';
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
      [{ totalAgents }],
      [{ totalMessages }],
      [{ totalAgentMessages }],
      [{ newUsersToday }],
      [{ newUsersWeek }],
      [{ newUsersMonth }],
      [{ sessionsToday }],
      [{ messagesWeek }],
    ] = await Promise.all([
      db.select({ totalUsers: count() }).from(users),
      db.select({ totalSessions: count() }).from(sessions),
      db.select({ totalAgents: count() }).from(assistants),
      db.select({ totalMessages: count() }).from(messages),
      db.select({ totalAgentMessages: count() }).from(agentMessages),
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
        agents: totalAgents,
        messages: totalMessages,
        agentMessages: totalAgentMessages,
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

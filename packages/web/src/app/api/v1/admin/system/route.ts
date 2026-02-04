import { db } from '@/db';
import { users, sessions } from '@/db/schema';
import { withAdminAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { count, gte, and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

// GET /api/v1/admin/system - Get system health status
export const GET = withAdminAuth(async (request: AuthenticatedRequest) => {
  const { searchParams } = new URL(request.url);
  const check = searchParams.get('check');

  try {
    // Health check - verify database connectivity
    if (check === 'health') {
      const startTime = Date.now();

      // Simple query to check DB connectivity
      await db.select({ count: count() }).from(users).limit(1);

      const dbLatency = Date.now() - startTime;

      return successResponse({
        status: 'healthy',
        database: {
          status: 'connected',
          latencyMs: dbLatency,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Active sessions - count sessions with recent activity
    if (check === 'active-sessions') {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [activeLastHour, activeLastDay] = await Promise.all([
        db
          .select({ count: count() })
          .from(sessions)
          .where(gte(sessions.updatedAt, oneHourAgo)),
        db
          .select({ count: count() })
          .from(sessions)
          .where(gte(sessions.updatedAt, oneDayAgo)),
      ]);

      return successResponse({
        activeSessions: {
          lastHour: activeLastHour[0]?.count ?? 0,
          lastDay: activeLastDay[0]?.count ?? 0,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Full system status
    const startTime = Date.now();

    // Database check
    let dbStatus: 'connected' | 'error' = 'connected';
    let dbLatency = 0;
    let dbError: string | null = null;

    try {
      await db.select({ count: count() }).from(users).limit(1);
      dbLatency = Date.now() - startTime;
    } catch (err) {
      dbStatus = 'error';
      dbError = err instanceof Error ? err.message : 'Unknown error';
    }

    // Get active session counts
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [activeSessionsResult, activeUsersResult] = await Promise.all([
      db
        .select({ count: count() })
        .from(sessions)
        .where(gte(sessions.updatedAt, oneHourAgo)),
      db
        .select({ count: sql<number>`count(distinct ${sessions.userId})` })
        .from(sessions)
        .where(gte(sessions.updatedAt, oneHourAgo)),
    ]);

    const overallStatus = dbStatus === 'connected' ? 'healthy' : 'degraded';

    return successResponse({
      status: overallStatus,
      database: {
        status: dbStatus,
        latencyMs: dbLatency,
        error: dbError,
      },
      activity: {
        activeSessionsLastHour: activeSessionsResult[0]?.count ?? 0,
        activeUsersLastHour: activeUsersResult[0]?.count ?? 0,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
});

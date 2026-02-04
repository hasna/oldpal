import { db } from '@/db';
import { notifications } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';

// GET /api/v1/notifications - Get user's notifications
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;
    const { searchParams } = new URL(request.url);

    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const unreadOnly = searchParams.get('unread') === 'true';

    // Build where clause
    const whereClause = unreadOnly
      ? and(eq(notifications.userId, userId), eq(notifications.isRead, false))
      : eq(notifications.userId, userId);

    // Get notifications
    const userNotifications = await db.query.notifications.findMany({
      where: whereClause,
      orderBy: [desc(notifications.createdAt)],
      limit,
    });

    // Get unread count
    const unreadCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

    const unreadCount = unreadCountResult[0]?.count ?? 0;

    return successResponse({
      notifications: userNotifications,
      unreadCount,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/notifications - Mark notifications as read
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;
    const body = await request.json();
    const { notificationIds, markAllRead } = body;

    if (markAllRead) {
      // Mark all as read
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

      return successResponse({ message: 'All notifications marked as read' });
    }

    if (notificationIds && Array.isArray(notificationIds)) {
      // Mark specific notifications as read
      for (const id of notificationIds) {
        await db
          .update(notifications)
          .set({ isRead: true })
          .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
      }

      return successResponse({ message: 'Notifications marked as read' });
    }

    return errorResponse(new Error('Invalid request'));
  } catch (error) {
    return errorResponse(error);
  }
});

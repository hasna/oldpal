import { db } from '@/db';
import { loginHistory } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { paginatedResponse, errorResponse } from '@/lib/api/response';
import { eq, desc, count, and } from 'drizzle-orm';

// GET /api/v1/users/me/login-history - Get user's login history
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;
    const showFailed = searchParams.get('showFailed') === 'true';

    const userId = request.user.userId;

    // Build where clause
    const whereClause = showFailed
      ? eq(loginHistory.userId, userId)
      : and(eq(loginHistory.userId, userId), eq(loginHistory.success, true));

    const [logins, [{ total }]] = await Promise.all([
      db.query.loginHistory.findMany({
        where: whereClause,
        orderBy: [desc(loginHistory.createdAt)],
        limit,
        offset,
      }),
      db.select({ total: count() }).from(loginHistory).where(whereClause!),
    ]);

    // Format the response
    const formattedLogins = logins.map((login) => ({
      id: login.id,
      success: login.success,
      device: login.device,
      browser: login.browser,
      os: login.os,
      ipAddress: login.ipAddress,
      country: login.country,
      city: login.city,
      isNewDevice: login.isNewDevice,
      failureReason: login.failureReason,
      createdAt: login.createdAt,
    }));

    return paginatedResponse(formattedLogins, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

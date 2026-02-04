import { db } from '@/db';
import { adminAuditLogs, users } from '@/db/schema';
import { withAdminAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { paginatedResponse, errorResponse } from '@/lib/api/response';
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit';
import { desc, count, eq, and, gte, lte, type SQL } from 'drizzle-orm';
import { isValidUUID } from '@/lib/api/errors';

// GET /api/v1/admin/audit - List audit logs with filtering
export const GET = withAdminAuth(async (request: AuthenticatedRequest) => {
  const rateLimitResponse = checkRateLimit(request, 'admin/audit', RateLimitPresets.api);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;

    // Filter parameters
    const action = searchParams.get('action');
    const adminId = searchParams.get('adminId');
    const targetType = searchParams.get('targetType');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Build where conditions
    const conditions: SQL[] = [];

    if (action) {
      conditions.push(eq(adminAuditLogs.action, action));
    }

    if (adminId && isValidUUID(adminId)) {
      conditions.push(eq(adminAuditLogs.adminUserId, adminId));
    }

    if (targetType) {
      conditions.push(eq(adminAuditLogs.targetType, targetType));
    }

    if (startDate) {
      const start = new Date(startDate);
      if (!Number.isNaN(start.getTime())) {
        conditions.push(gte(adminAuditLogs.createdAt, start));
      }
    }

    if (endDate) {
      const end = new Date(endDate);
      if (!Number.isNaN(end.getTime())) {
        // Set end of day
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(adminAuditLogs.createdAt, end));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch logs with admin user info
    const [logs, [{ total }]] = await Promise.all([
      db
        .select({
          id: adminAuditLogs.id,
          action: adminAuditLogs.action,
          targetType: adminAuditLogs.targetType,
          targetId: adminAuditLogs.targetId,
          changes: adminAuditLogs.changes,
          metadata: adminAuditLogs.metadata,
          ipAddress: adminAuditLogs.ipAddress,
          createdAt: adminAuditLogs.createdAt,
          adminUser: {
            id: users.id,
            email: users.email,
            name: users.name,
          },
        })
        .from(adminAuditLogs)
        .leftJoin(users, eq(adminAuditLogs.adminUserId, users.id))
        .where(whereClause)
        .orderBy(desc(adminAuditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      whereClause
        ? db.select({ total: count() }).from(adminAuditLogs).where(whereClause)
        : db.select({ total: count() }).from(adminAuditLogs),
    ]);

    return paginatedResponse(logs, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

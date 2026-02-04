import { NextRequest } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { withAdminAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { paginatedResponse, errorResponse } from '@/lib/api/response';
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit';
import { desc, asc, count, ilike, or, eq, and } from 'drizzle-orm';

// GET /api/v1/admin/users - List all users (admin only)
export const GET = withAdminAuth(async (request: AuthenticatedRequest) => {
  // Rate limit admin endpoints
  const rateLimitResponse = checkRateLimit(request, 'admin/users', RateLimitPresets.api);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;
    const search = searchParams.get('search');
    const roleFilter = searchParams.get('role');
    const statusFilter = searchParams.get('status');

    // Sorting parameters
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortDir = searchParams.get('sortDir') || 'desc';

    // Validate sortBy to prevent SQL injection
    const validSortColumns = ['email', 'name', 'role', 'createdAt'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = sortDir === 'asc' ? asc : desc;

    // Build filter conditions
    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(users.email, `%${search}%`),
          ilike(users.name, `%${search}%`)
        )
      );
    }

    if (roleFilter && (roleFilter === 'admin' || roleFilter === 'user')) {
      conditions.push(eq(users.role, roleFilter));
    }

    if (statusFilter === 'active') {
      conditions.push(eq(users.isActive, true));
    } else if (statusFilter === 'suspended') {
      conditions.push(eq(users.isActive, false));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Build order by based on sort column
    const getOrderBy = () => {
      switch (sortColumn) {
        case 'email':
          return [sortDirection(users.email)];
        case 'name':
          return [sortDirection(users.name)];
        case 'role':
          return [sortDirection(users.role)];
        case 'createdAt':
        default:
          return [sortDirection(users.createdAt)];
      }
    };

    // Build queries - only apply where clause if filters are provided
    const [userList, [{ total }]] = await Promise.all([
      db.query.users.findMany({
        ...(whereClause && { where: whereClause }),
        orderBy: getOrderBy(),
        limit,
        offset,
        columns: {
          id: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
          avatarUrl: true,
          isActive: true,
          suspendedReason: true,
          createdAt: true,
        },
      }),
      whereClause
        ? db.select({ total: count() }).from(users).where(whereClause)
        : db.select({ total: count() }).from(users),
    ]);

    return paginatedResponse(userList, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

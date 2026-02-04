import { NextRequest } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { withAdminAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { paginatedResponse, errorResponse } from '@/lib/api/response';
import { desc, count, ilike, or } from 'drizzle-orm';

// GET /api/v1/admin/users - List all users (admin only)
export const GET = withAdminAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;
    const search = searchParams.get('search');

    const whereClause = search
      ? or(
          ilike(users.email, `%${search}%`),
          ilike(users.name, `%${search}%`)
        )
      : undefined;

    // Build queries - only apply where clause if search is provided
    const [userList, [{ total }]] = await Promise.all([
      db.query.users.findMany({
        ...(whereClause && { where: whereClause }),
        orderBy: [desc(users.createdAt)],
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

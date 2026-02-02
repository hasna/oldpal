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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;
    const search = searchParams.get('search');

    let whereClause;
    if (search) {
      whereClause = or(
        ilike(users.email, `%${search}%`),
        ilike(users.name, `%${search}%`)
      );
    }

    const [userList, [{ total }]] = await Promise.all([
      db.query.users.findMany({
        where: whereClause,
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
          createdAt: true,
        },
      }),
      db.select({ total: count() }).from(users).where(whereClause),
    ]);

    return paginatedResponse(userList, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

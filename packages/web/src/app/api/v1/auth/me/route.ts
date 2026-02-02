import { NextRequest } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError } from '@/lib/api/errors';
import { eq } from 'drizzle-orm';

export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, request.user.userId),
    });

    if (!user) {
      return errorResponse(new NotFoundError('User not found'));
    }

    return successResponse({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
});

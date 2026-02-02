import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { users } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError } from '@/lib/api/errors';
import { eq } from 'drizzle-orm';

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

// GET /api/v1/users/:id - Get user profile
export const GET = withAuth(async (request: AuthenticatedRequest, { params }: { params: { id: string } }) => {
  try {
    // Users can only view their own profile (unless admin)
    if (params.id !== request.user.userId && request.user.role !== 'admin') {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, params.id),
      columns: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      return errorResponse(new NotFoundError('User not found'));
    }

    return successResponse(user);
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/users/:id - Update user profile
export const PATCH = withAuth(async (request: AuthenticatedRequest, { params }: { params: { id: string } }) => {
  try {
    // Users can only update their own profile
    if (params.id !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    const body = await request.json();
    const data = updateUserSchema.parse(body);

    const [updatedUser] = await db
      .update(users)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(users.id, params.id))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: users.role,
      });

    if (!updatedUser) {
      return errorResponse(new NotFoundError('User not found'));
    }

    return successResponse(updatedUser);
  } catch (error) {
    return errorResponse(error);
  }
});

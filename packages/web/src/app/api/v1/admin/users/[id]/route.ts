import { NextRequest } from 'next/server';
import { db } from '@/db';
import { users, sessions, agents } from '@/db/schema';
import { withAdminAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { eq, count } from 'drizzle-orm';
import { z } from 'zod';
import { logAdminAction, computeChanges } from '@/lib/admin/audit';

type RouteContext = { params: Promise<{ id: string }> };

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
  role: z.enum(['user', 'admin']).optional(),
  isActive: z.boolean().optional(),
  suspendedReason: z.string().max(500).optional().nullable(),
});

// GET /api/v1/admin/users/:id - Get user details with stats
export const GET = withAdminAuth(async (request: AuthenticatedRequest, context: RouteContext) => {
  try {
    const { id } = await context.params;
    validateUUID(id, 'user id');

    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        avatarUrl: true,
        isActive: true,
        suspendedAt: true,
        suspendedReason: true,
        stripeCustomerId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Get counts for sessions and agents
    const [sessionCount, agentCount] = await Promise.all([
      db.select({ count: count() }).from(sessions).where(eq(sessions.userId, id)),
      db.select({ count: count() }).from(agents).where(eq(agents.userId, id)),
    ]);

    return successResponse({
      ...user,
      _counts: {
        sessions: sessionCount[0]?.count ?? 0,
        agents: agentCount[0]?.count ?? 0,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/admin/users/:id - Update user
export const PATCH = withAdminAuth(async (request: AuthenticatedRequest, context: RouteContext) => {
  try {
    const { id } = await context.params;
    validateUUID(id, 'user id');

    const body = await request.json();
    const validated = updateUserSchema.parse(body);

    // Fetch current user
    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!currentUser) {
      throw new NotFoundError('User not found');
    }

    // Prevent admin from demoting themselves
    if (validated.role === 'user' && id === request.user.userId) {
      throw new BadRequestError('Cannot demote yourself');
    }

    // Prevent suspending yourself
    if (validated.isActive === false && id === request.user.userId) {
      throw new BadRequestError('Cannot suspend yourself');
    }

    // If demoting from admin, ensure there's at least one other admin
    if (validated.role === 'user' && currentUser.role === 'admin') {
      const adminCount = await db
        .select({ count: count() })
        .from(users)
        .where(eq(users.role, 'admin'));

      if (adminCount[0].count <= 1) {
        throw new BadRequestError('Cannot demote the last admin user');
      }
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      ...validated,
      updatedAt: new Date(),
    };

    // Handle suspension status changes
    if (validated.isActive === false && currentUser.isActive === true) {
      updateData.suspendedAt = new Date();
    } else if (validated.isActive === true && currentUser.isActive === false) {
      updateData.suspendedAt = null;
      updateData.suspendedReason = null;
    }

    // Update user
    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        emailVerified: users.emailVerified,
        avatarUrl: users.avatarUrl,
        isActive: users.isActive,
        suspendedAt: users.suspendedAt,
        suspendedReason: users.suspendedReason,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    // Log the action
    const changes = computeChanges(
      {
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role,
        isActive: currentUser.isActive,
        suspendedReason: currentUser.suspendedReason,
      },
      validated
    );

    if (changes) {
      await logAdminAction({
        adminUserId: request.user.userId,
        action: 'user.update',
        targetType: 'user',
        targetId: id,
        changes,
        request,
      });
    }

    return successResponse(updatedUser);
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/admin/users/:id - Soft-delete user (set inactive)
export const DELETE = withAdminAuth(async (request: AuthenticatedRequest, context: RouteContext) => {
  try {
    const { id } = await context.params;
    validateUUID(id, 'user id');

    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!currentUser) {
      throw new NotFoundError('User not found');
    }

    // Prevent deleting yourself
    if (id === request.user.userId) {
      throw new BadRequestError('Cannot delete yourself');
    }

    // Prevent deleting last admin
    if (currentUser.role === 'admin') {
      const adminCount = await db
        .select({ count: count() })
        .from(users)
        .where(eq(users.role, 'admin'));

      if (adminCount[0].count <= 1) {
        throw new BadRequestError('Cannot delete the last admin user');
      }
    }

    // Soft delete by setting inactive
    await db
      .update(users)
      .set({
        isActive: false,
        suspendedAt: new Date(),
        suspendedReason: 'Account deleted by admin',
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    // Log the action
    await logAdminAction({
      adminUserId: request.user.userId,
      action: 'user.delete',
      targetType: 'user',
      targetId: id,
      metadata: {
        userEmail: currentUser.email,
        userName: currentUser.name,
      },
      request,
    });

    return successResponse({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
});

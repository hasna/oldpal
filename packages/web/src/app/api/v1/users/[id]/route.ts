import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { users, agents, agentMessages } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { eq, inArray, or } from 'drizzle-orm';

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

async function resolveParams(
  context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }
): Promise<Record<string, string> | undefined> {
  if (!context?.params) return undefined;
  const params = await Promise.resolve(context.params as Record<string, string>);
  return params;
}

// GET /api/v1/users/:id - Get user profile
export const GET = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing user id'));
    }
    validateUUID(id, 'user id');

    // Users can only view their own profile (unless admin)
    if (id !== request.user.userId && request.user.role !== 'admin') {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
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
export const PATCH = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing user id'));
    }
    validateUUID(id, 'user id');

    // Users can only update their own profile
    if (id !== request.user.userId) {
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
      .where(eq(users.id, id))
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

// DELETE /api/v1/users/:id - Delete user account
export const DELETE = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing user id'));
    }
    validateUUID(id, 'user id');

    // Users can only delete their own account (admins cannot delete other users for safety)
    if (id !== request.user.userId) {
      return errorResponse(new ForbiddenError('You can only delete your own account'));
    }

    // Verify user exists
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true },
    });

    if (!user) {
      return errorResponse(new NotFoundError('User not found'));
    }

    // Use a transaction to ensure all deletions succeed or fail together
    await db.transaction(async (tx) => {
      // 1. Get all agent IDs owned by the user
      const userAgents = await tx.query.agents.findMany({
        where: eq(agents.userId, id),
        columns: { id: true },
      });
      const agentIds = userAgents.map((a) => a.id);

      // 2. Delete agent_messages where fromAgentId or toAgentId belongs to user's agents
      // (these would be orphaned with SET NULL, so clean them up properly)
      if (agentIds.length > 0) {
        await tx
          .delete(agentMessages)
          .where(or(inArray(agentMessages.fromAgentId, agentIds), inArray(agentMessages.toAgentId, agentIds)));
      }

      // 3. Delete the user - cascades will handle:
      //    - refresh_tokens (CASCADE)
      //    - agents (CASCADE)
      //    - sessions (CASCADE) -> messages (CASCADE)
      //    - schedules (CASCADE)
      await tx.delete(users).where(eq(users.id, id));
    });

    return successResponse({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
});

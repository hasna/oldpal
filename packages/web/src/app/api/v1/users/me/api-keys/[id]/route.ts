import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError } from '@/lib/api/errors';
import { eq, and, isNull } from 'drizzle-orm';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/v1/users/me/api-keys/[id] - Get a specific API key
export const GET = withAuth(async (request: AuthenticatedRequest, context: RouteContext) => {
  try {
    const { id } = await context.params;
    const userId = request.user.userId;

    const key = await db.query.apiKeys.findFirst({
      where: and(
        eq(apiKeys.id, id),
        isNull(apiKeys.revokedAt)
      ),
    });

    if (!key) {
      throw new NotFoundError('API key not found');
    }

    // Verify ownership
    if (key.userId !== userId) {
      throw new ForbiddenError('Access denied');
    }

    return successResponse({
      key: {
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        permissions: key.permissions,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/users/me/api-keys/[id] - Revoke an API key
export const DELETE = withAuth(async (request: AuthenticatedRequest, context: RouteContext) => {
  try {
    const { id } = await context.params;
    const userId = request.user.userId;

    // Find the key
    const key = await db.query.apiKeys.findFirst({
      where: and(
        eq(apiKeys.id, id),
        isNull(apiKeys.revokedAt)
      ),
    });

    if (!key) {
      throw new NotFoundError('API key not found');
    }

    // Verify ownership
    if (key.userId !== userId) {
      throw new ForbiddenError('Access denied');
    }

    // Revoke the key (soft delete)
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, id));

    return successResponse({
      success: true,
      message: 'API key revoked successfully',
    });
  } catch (error) {
    return errorResponse(error);
  }
});

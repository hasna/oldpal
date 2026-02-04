import { db } from '@/db';
import { identities } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { eq, and } from 'drizzle-orm';

async function resolveParams(
  context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<object> }
): Promise<Record<string, string> | undefined> {
  if (!context?.params) return undefined;
  const params = await Promise.resolve(context.params as Record<string, string>);
  return params;
}

// POST /api/v1/identities/:id/default - Set identity as default
export const POST = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<object> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing identity id'));
    }
    validateUUID(id, 'identity id');

    // Check ownership
    const existingIdentity = await db.query.identities.findFirst({
      where: eq(identities.id, id),
    });

    if (!existingIdentity) {
      return errorResponse(new NotFoundError('Identity not found'));
    }

    if (existingIdentity.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    // Unset any existing default
    await db
      .update(identities)
      .set({ isDefault: false })
      .where(and(
        eq(identities.userId, request.user.userId),
        eq(identities.isDefault, true)
      ));

    // Set this identity as default
    const [updatedIdentity] = await db
      .update(identities)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(identities.id, id))
      .returning();

    return successResponse(updatedIdentity);
  } catch (error) {
    return errorResponse(error);
  }
});

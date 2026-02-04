import { z } from 'zod';
import { db } from '@/db';
import { users } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { logAdminAction } from '@/lib/admin/audit';
import { eq } from 'drizzle-orm';

// Password validation: minimum 8 characters, at least one uppercase, one lowercase, one number
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'New password must be different from current password',
  path: ['newPassword'],
});

async function resolveParams(
  context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }
): Promise<Record<string, string> | undefined> {
  if (!context?.params) return undefined;
  const params = await Promise.resolve(context.params as Record<string, string>);
  return params;
}

// PATCH /api/v1/users/:id/password - Change user password
export const PATCH = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing user id'));
    }
    validateUUID(id, 'user id');

    // Users can only change their own password
    if (id !== request.user.userId) {
      return errorResponse(new ForbiddenError('You can only change your own password'));
    }

    // Parse and validate request body
    const body = await request.json();
    const validationResult = changePasswordSchema.safeParse(body);

    if (!validationResult.success) {
      return errorResponse(new BadRequestError(validationResult.error.errors[0].message));
    }

    const { currentPassword, newPassword } = validationResult.data;

    // Get user with passwordHash
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: {
        id: true,
        passwordHash: true,
        googleId: true,
      },
    });

    if (!user) {
      return errorResponse(new NotFoundError('User not found'));
    }

    // Check if user is OAuth-only (no password set)
    if (!user.passwordHash) {
      return errorResponse(new BadRequestError('Cannot change password for OAuth-only accounts. Please use your OAuth provider to manage your credentials.'));
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      // Log failed attempt
      await logAdminAction({
        adminUserId: request.user.userId,
        action: 'password.change_failed',
        targetType: 'user',
        targetId: id,
        metadata: { reason: 'invalid_current_password' },
        request,
      });
      return errorResponse(new BadRequestError('Current password is incorrect'));
    }

    // Hash new password and update
    const newPasswordHash = await hashPassword(newPassword);

    await db
      .update(users)
      .set({
        passwordHash: newPasswordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    // Log successful password change
    await logAdminAction({
      adminUserId: request.user.userId,
      action: 'password.changed',
      targetType: 'user',
      targetId: id,
      request,
    });

    return successResponse({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    return errorResponse(error);
  }
});

import { db } from '@/db';
import { users } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { BadRequestError, NotFoundError } from '@/lib/api/errors';
import { createCustomerPortalSession } from '@/lib/stripe';
import { eq } from 'drizzle-orm';

export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;

    // Get user
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (!user.stripeCustomerId) {
      throw new BadRequestError('No billing account found. Please subscribe to a paid plan first.');
    }

    // Create customer portal session
    const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3001';
    const session = await createCustomerPortalSession({
      customerId: user.stripeCustomerId,
      returnUrl: `${baseUrl}/billing`,
    });

    return successResponse({
      portalUrl: session.url,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

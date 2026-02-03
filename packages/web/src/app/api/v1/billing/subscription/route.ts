import { NextResponse } from 'next/server';
import { db } from '@/db';
import { subscriptions, subscriptionPlans, users } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError } from '@/lib/api/errors';
import { eq } from 'drizzle-orm';

export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;

    // Get user's subscription with plan details
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
      with: {
        plan: true,
      },
    });

    if (!subscription) {
      // Return free plan info if no subscription
      const freePlan = await db.query.subscriptionPlans.findFirst({
        where: eq(subscriptionPlans.name, 'free'),
      });

      return successResponse({
        subscription: null,
        plan: freePlan,
        isFreeTier: true,
      });
    }

    return successResponse({
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      plan: subscription.plan,
      isFreeTier: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

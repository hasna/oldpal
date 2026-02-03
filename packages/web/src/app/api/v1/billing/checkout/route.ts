import { z } from 'zod';
import { db } from '@/db';
import { subscriptionPlans, users } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { BadRequestError, NotFoundError } from '@/lib/api/errors';
import { createStripeCustomer, createCheckoutSession } from '@/lib/stripe';
import { eq } from 'drizzle-orm';

const checkoutSchema = z.object({
  planId: z.string().uuid('Invalid plan ID'),
});

export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const body = await request.json();
    const { planId } = checkoutSchema.parse(body);

    const userId = request.user.userId;

    // Get the plan
    const plan = await db.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
    });

    if (!plan) {
      throw new NotFoundError('Plan not found');
    }

    if (!plan.stripePriceId) {
      throw new BadRequestError('Cannot checkout free plan');
    }

    // Get user
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Create or get Stripe customer
    let stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await createStripeCustomer(user.email, user.name);
      stripeCustomerId = customer.id;

      // Update user with Stripe customer ID
      await db
        .update(users)
        .set({ stripeCustomerId, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    // Create checkout session
    const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3001';
    const session = await createCheckoutSession({
      customerId: stripeCustomerId,
      priceId: plan.stripePriceId,
      successUrl: `${baseUrl}/billing?success=true`,
      cancelUrl: `${baseUrl}/billing?canceled=true`,
    });

    return successResponse({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

import { db } from '@/db';
import { users } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/lib/api/errors';
import { setDefaultPaymentMethod, detachPaymentMethod, listPaymentMethods } from '@/lib/stripe';
import { eq } from 'drizzle-orm';

// PATCH /api/v1/billing/payment-methods/[id] - Set as default payment method
export const PATCH = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id: paymentMethodId } = await params;
    const userId = request.user.userId;

    // Get user's Stripe customer ID
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        stripeCustomerId: true,
      },
    });

    if (!user?.stripeCustomerId) {
      return errorResponse(new NotFoundError('No billing account found'));
    }

    // Verify the payment method belongs to this customer
    const paymentMethods = await listPaymentMethods(user.stripeCustomerId);
    const paymentMethod = paymentMethods.data.find(pm => pm.id === paymentMethodId);

    if (!paymentMethod) {
      return errorResponse(new ForbiddenError('Payment method does not belong to your account'));
    }

    // Set as default
    await setDefaultPaymentMethod(user.stripeCustomerId, paymentMethodId);

    return successResponse({
      success: true,
      message: 'Default payment method updated',
    });
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/billing/payment-methods/[id] - Remove payment method
export const DELETE = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id: paymentMethodId } = await params;
    const userId = request.user.userId;

    // Get user's Stripe customer ID
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        stripeCustomerId: true,
      },
    });

    if (!user?.stripeCustomerId) {
      return errorResponse(new NotFoundError('No billing account found'));
    }

    // Verify the payment method belongs to this customer
    const paymentMethods = await listPaymentMethods(user.stripeCustomerId);
    const paymentMethod = paymentMethods.data.find(pm => pm.id === paymentMethodId);

    if (!paymentMethod) {
      return errorResponse(new ForbiddenError('Payment method does not belong to your account'));
    }

    // Check if this is the only payment method and user has active subscription
    if (paymentMethods.data.length === 1) {
      return errorResponse(new BadRequestError('Cannot remove the only payment method. Please add another payment method first.'));
    }

    // Detach the payment method
    await detachPaymentMethod(paymentMethodId);

    return successResponse({
      success: true,
      message: 'Payment method removed',
    });
  } catch (error) {
    return errorResponse(error);
  }
});

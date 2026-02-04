import { db } from '@/db';
import { users } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, BadRequestError } from '@/lib/api/errors';
import { listPaymentMethods, getCustomer, createSetupIntent } from '@/lib/stripe';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

// GET /api/v1/billing/payment-methods - List user's payment methods
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;

    // Get user's Stripe customer ID
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        stripeCustomerId: true,
      },
    });

    if (!user?.stripeCustomerId) {
      return successResponse({
        paymentMethods: [],
        defaultPaymentMethodId: null,
      });
    }

    // Get customer to find default payment method
    const customer = await getCustomer(user.stripeCustomerId) as Stripe.Customer;
    const defaultPaymentMethodId = typeof customer.invoice_settings?.default_payment_method === 'string'
      ? customer.invoice_settings.default_payment_method
      : customer.invoice_settings?.default_payment_method?.id || null;

    // Get payment methods
    const paymentMethodsResponse = await listPaymentMethods(user.stripeCustomerId);

    const paymentMethods = paymentMethodsResponse.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand,
      last4: pm.card?.last4,
      expMonth: pm.card?.exp_month,
      expYear: pm.card?.exp_year,
      isDefault: pm.id === defaultPaymentMethodId,
    }));

    return successResponse({
      paymentMethods,
      defaultPaymentMethodId,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/billing/payment-methods - Create setup intent for adding new payment method
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;

    // Get user's Stripe customer ID
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        stripeCustomerId: true,
      },
    });

    if (!user?.stripeCustomerId) {
      return errorResponse(new NotFoundError('No billing account found. Please subscribe to a plan first.'));
    }

    // Create a setup intent
    const setupIntent = await createSetupIntent(user.stripeCustomerId);

    return successResponse({
      clientSecret: setupIntent.client_secret,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

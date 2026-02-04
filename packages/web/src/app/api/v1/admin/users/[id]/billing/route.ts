import { db } from '@/db';
import { users, subscriptions, subscriptionPlans, invoices } from '@/db/schema';
import { withAdminAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { logAdminAction, computeChanges } from '@/lib/admin/audit';

type RouteContext = { params: Promise<{ id: string }> };

const overridePlanSchema = z.object({
  planId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

// GET /api/v1/admin/users/:id/billing - Get user's billing info
export const GET = withAdminAuth(async (request: AuthenticatedRequest, context: RouteContext) => {
  try {
    const { id } = await context.params;
    validateUUID(id, 'user id');

    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: {
        id: true,
        stripeCustomerId: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Get subscription with plan
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, id),
      with: {
        plan: true,
      },
    });

    // Get recent invoices
    const recentInvoices = await db.query.invoices.findMany({
      where: eq(invoices.userId, id),
      orderBy: [desc(invoices.createdAt)],
      limit: 10,
    });

    // Get all available plans for override
    const availablePlans = await db.query.subscriptionPlans.findMany({
      where: eq(subscriptionPlans.isActive, true),
      orderBy: [subscriptionPlans.priceMonthly],
    });

    return successResponse({
      stripeCustomerId: user.stripeCustomerId,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            plan: {
              id: subscription.plan.id,
              name: subscription.plan.name,
              displayName: subscription.plan.displayName,
              priceMonthly: subscription.plan.priceMonthly,
            },
          }
        : null,
      invoices: recentInvoices.map((inv) => ({
        id: inv.id,
        amountDue: inv.amountDue,
        amountPaid: inv.amountPaid,
        status: inv.status,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        paidAt: inv.paidAt,
        invoiceUrl: inv.invoiceUrl,
        createdAt: inv.createdAt,
      })),
      availablePlans: availablePlans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        displayName: plan.displayName,
        priceMonthly: plan.priceMonthly,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/admin/users/:id/billing/override - Override user's plan
export const POST = withAdminAuth(async (request: AuthenticatedRequest, context: RouteContext) => {
  try {
    const { id } = await context.params;
    validateUUID(id, 'user id');

    const body = await request.json();
    const { planId, reason } = overridePlanSchema.parse(body);

    // Verify user exists
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify plan exists
    const plan = await db.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
    });

    if (!plan) {
      throw new BadRequestError('Invalid plan');
    }

    // Get current subscription
    const currentSubscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, id),
      with: {
        plan: true,
      },
    });

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    if (currentSubscription) {
      // Update existing subscription
      await db
        .update(subscriptions)
        .set({
          planId,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, currentSubscription.id));

      // Log the action
      await logAdminAction({
        adminUserId: request.user.userId,
        action: 'billing.override',
        targetType: 'subscription',
        targetId: currentSubscription.id,
        changes: computeChanges(
          { planId: currentSubscription.planId, planName: currentSubscription.plan.name },
          { planId, planName: plan.name }
        ),
        metadata: {
          userId: id,
          userEmail: user.email,
          reason,
          previousPlan: currentSubscription.plan.name,
          newPlan: plan.name,
        },
        request,
      });
    } else {
      // Create new subscription
      const [newSubscription] = await db
        .insert(subscriptions)
        .values({
          userId: id,
          planId,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        })
        .returning();

      // Log the action
      await logAdminAction({
        adminUserId: request.user.userId,
        action: 'billing.override',
        targetType: 'subscription',
        targetId: newSubscription.id,
        metadata: {
          userId: id,
          userEmail: user.email,
          reason,
          newPlan: plan.name,
          action: 'created',
        },
        request,
      });
    }

    // Return updated subscription
    const updatedSubscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, id),
      with: {
        plan: true,
      },
    });

    return successResponse({
      subscription: updatedSubscription
        ? {
            id: updatedSubscription.id,
            status: updatedSubscription.status,
            currentPeriodStart: updatedSubscription.currentPeriodStart,
            currentPeriodEnd: updatedSubscription.currentPeriodEnd,
            plan: {
              id: updatedSubscription.plan.id,
              name: updatedSubscription.plan.name,
              displayName: updatedSubscription.plan.displayName,
              priceMonthly: updatedSubscription.plan.priceMonthly,
            },
          }
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

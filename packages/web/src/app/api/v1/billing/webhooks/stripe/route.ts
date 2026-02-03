import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import {
  subscriptions,
  subscriptionPlans,
  invoices,
  users,
} from '@/db/schema';
import { constructWebhookEvent, stripe } from '@/lib/stripe';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(request: NextRequest) {
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = constructWebhookEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== 'subscription') return;

  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  // Get user by Stripe customer ID
  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });

  if (!user) {
    console.error(`No user found for Stripe customer: ${customerId}`);
    return;
  }

  // Get the subscription details from Stripe
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = stripeSubscription.items.data[0]?.price.id;

  // Find the plan by Stripe price ID
  const plan = await db.query.subscriptionPlans.findFirst({
    where: eq(subscriptionPlans.stripePriceId, priceId),
  });

  if (!plan) {
    console.error(`No plan found for Stripe price: ${priceId}`);
    return;
  }

  // Create or update subscription
  await db
    .insert(subscriptions)
    .values({
      userId: user.id,
      planId: plan.id,
      stripeSubscriptionId: subscriptionId,
      status: 'active',
      currentPeriodStart: new Date((stripeSubscription as unknown as { current_period_start: number }).current_period_start * 1000),
      currentPeriodEnd: new Date((stripeSubscription as unknown as { current_period_end: number }).current_period_end * 1000),
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        planId: plan.id,
        stripeSubscriptionId: subscriptionId,
        status: 'active',
        currentPeriodStart: new Date((stripeSubscription as unknown as { current_period_start: number }).current_period_start * 1000),
        currentPeriodEnd: new Date((stripeSubscription as unknown as { current_period_end: number }).current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        updatedAt: new Date(),
      },
    });
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const priceId = subscription.items.data[0]?.price.id;

  // Find the plan by Stripe price ID
  const plan = await db.query.subscriptionPlans.findFirst({
    where: eq(subscriptionPlans.stripePriceId, priceId),
  });

  // Map Stripe status to our status enum
  let status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'paused' = 'active';
  switch (subscription.status) {
    case 'active':
      status = 'active';
      break;
    case 'canceled':
      status = 'canceled';
      break;
    case 'past_due':
      status = 'past_due';
      break;
    case 'trialing':
      status = 'trialing';
      break;
    case 'paused':
      status = 'paused';
      break;
  }

  // Type assertion for subscription period fields
  const subData = subscription as unknown as {
    current_period_start: number;
    current_period_end: number;
  };

  const updateData: Record<string, unknown> = {
    status,
    currentPeriodStart: new Date(subData.current_period_start * 1000),
    currentPeriodEnd: new Date(subData.current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    updatedAt: new Date(),
  };

  if (plan) {
    updateData.planId = plan.id;
  }

  await db
    .update(subscriptions)
    .set(updateData)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  await db
    .update(subscriptions)
    .set({
      status: 'canceled',
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  // Get user by Stripe customer ID
  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });

  if (!user) {
    console.error(`No user found for Stripe customer: ${customerId}`);
    return;
  }

  // Type assertion for invoice fields that may have changed in API
  const invoiceData = invoice as unknown as {
    subscription?: string;
    period_start?: number;
    period_end?: number;
  };

  await db
    .insert(invoices)
    .values({
      userId: user.id,
      stripeInvoiceId: invoice.id,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      status: 'paid',
      invoiceUrl: invoice.hosted_invoice_url || undefined,
      pdfUrl: invoice.invoice_pdf || undefined,
      periodStart: invoiceData.period_start ? new Date(invoiceData.period_start * 1000) : undefined,
      periodEnd: invoiceData.period_end ? new Date(invoiceData.period_end * 1000) : undefined,
      paidAt: new Date(),
    })
    .onConflictDoUpdate({
      target: invoices.stripeInvoiceId,
      set: {
        amountPaid: invoice.amount_paid,
        status: 'paid',
        paidAt: new Date(),
      },
    });

  // Also update subscription status if it was past_due
  if (invoiceData.subscription) {
    await db
      .update(subscriptions)
      .set({
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, invoiceData.subscription));
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  // Get user by Stripe customer ID
  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });

  if (!user) {
    console.error(`No user found for Stripe customer: ${customerId}`);
    return;
  }

  // Type assertion for invoice fields that may have changed in API
  const invoiceData = invoice as unknown as {
    subscription?: string;
    period_start?: number;
    period_end?: number;
  };

  await db
    .insert(invoices)
    .values({
      userId: user.id,
      stripeInvoiceId: invoice.id,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid || 0,
      status: 'open',
      invoiceUrl: invoice.hosted_invoice_url || undefined,
      pdfUrl: invoice.invoice_pdf || undefined,
      periodStart: invoiceData.period_start ? new Date(invoiceData.period_start * 1000) : undefined,
      periodEnd: invoiceData.period_end ? new Date(invoiceData.period_end * 1000) : undefined,
    })
    .onConflictDoUpdate({
      target: invoices.stripeInvoiceId,
      set: {
        status: 'open',
      },
    });

  // Update subscription status to past_due
  if (invoiceData.subscription) {
    await db
      .update(subscriptions)
      .set({
        status: 'past_due',
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, invoiceData.subscription));
  }
}

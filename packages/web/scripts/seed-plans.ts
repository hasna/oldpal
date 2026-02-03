import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { subscriptionPlans } from '../src/db/schema/subscription-plans';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is not set');
  process.exit(1);
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

const defaultPlans = [
  {
    name: 'free',
    displayName: 'Free',
    stripePriceId: null,
    priceMonthly: 0,
    maxAgents: 5,
    maxMessagesPerDay: 100,
    maxSessions: 10,
    features: [
      'Up to 5 agents',
      '100 messages per day',
      '10 active sessions',
      'Community support',
    ],
  },
  {
    name: 'pro',
    displayName: 'Pro',
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID || null,
    priceMonthly: 1900, // $19 in cents
    maxAgents: 50,
    maxMessagesPerDay: 2000,
    maxSessions: -1, // unlimited
    features: [
      'Up to 50 agents',
      '2,000 messages per day',
      'Unlimited sessions',
      'Priority support',
      'Advanced analytics',
    ],
  },
  {
    name: 'enterprise',
    displayName: 'Enterprise',
    stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || null,
    priceMonthly: 9900, // $99 in cents
    maxAgents: -1, // unlimited
    maxMessagesPerDay: -1, // unlimited
    maxSessions: -1, // unlimited
    features: [
      'Unlimited agents',
      'Unlimited messages',
      'Unlimited sessions',
      'Priority support',
      'Advanced analytics',
      'Custom integrations',
      'Dedicated account manager',
    ],
  },
];

async function seedPlans() {
  console.log('Seeding subscription plans...');

  try {
    for (const plan of defaultPlans) {
      await db
        .insert(subscriptionPlans)
        .values(plan)
        .onConflictDoNothing();
      console.log(`  Seeded plan: ${plan.displayName} ($${plan.priceMonthly / 100}/month)`);
    }

    console.log('Subscription plans seeded successfully!');
  } catch (error) {
    console.error('Error seeding plans:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seedPlans();

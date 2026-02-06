import { pgTable, uuid, varchar, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(), // 'free', 'pro', 'enterprise'
  displayName: varchar('display_name', { length: 100 }).notNull(),
  stripePriceId: varchar('stripe_price_id', { length: 255 }), // null for free tier
  priceMonthly: integer('price_monthly').notNull(), // cents
  maxAssistants: integer('max_agents').notNull(),
  maxMessagesPerDay: integer('max_messages_per_day').notNull(),
  maxSessions: integer('max_sessions').notNull(), // -1 = unlimited
  features: jsonb('features').$type<string[]>().default([]),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type NewSubscriptionPlan = typeof subscriptionPlans.$inferInsert;

import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const usageMetrics = pgTable(
  'usage_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    metricType: varchar('metric_type', { length: 50 }).notNull(), // 'messages', 'assistants', 'sessions'
    count: integer('count').default(0).notNull(),
    periodStart: timestamp('period_start').notNull(),
    periodEnd: timestamp('period_end').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('usage_metrics_user_metric_period_idx').on(
      table.userId,
      table.metricType,
      table.periodStart
    ),
  ]
);

export const usageMetricsRelations = relations(usageMetrics, ({ one }) => ({
  user: one(users, {
    fields: [usageMetrics.userId],
    references: [users.id],
  }),
}));

export type UsageMetric = typeof usageMetrics.$inferSelect;
export type NewUsageMetric = typeof usageMetrics.$inferInsert;

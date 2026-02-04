import { pgTable, uuid, varchar, text, timestamp, boolean, inet } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const loginHistory = pgTable('login_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  success: boolean('success').notNull().default(true),
  ipAddress: varchar('ip_address', { length: 45 }), // IPv6 can be up to 45 chars
  userAgent: text('user_agent'),
  device: varchar('device', { length: 100 }), // Parsed device name
  browser: varchar('browser', { length: 100 }), // Parsed browser name
  os: varchar('os', { length: 100 }), // Parsed OS name
  country: varchar('country', { length: 100 }),
  city: varchar('city', { length: 100 }),
  region: varchar('region', { length: 100 }),
  isNewDevice: boolean('is_new_device').default(false),
  failureReason: varchar('failure_reason', { length: 255 }), // 'invalid_password', 'account_locked', etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const loginHistoryRelations = relations(loginHistory, ({ one }) => ({
  user: one(users, {
    fields: [loginHistory.userId],
    references: [users.id],
  }),
}));

export type LoginHistory = typeof loginHistory.$inferSelect;
export type NewLoginHistory = typeof loginHistory.$inferInsert;

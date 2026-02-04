import { pgTable, uuid, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: text('token_hash').unique().notNull(),
  family: uuid('family').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at'),
  // Session metadata
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  device: varchar('device', { length: 100 }),
  browser: varchar('browser', { length: 100 }),
  os: varchar('os', { length: 100 }),
});

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

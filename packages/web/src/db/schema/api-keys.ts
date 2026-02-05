import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(), // First 12 chars for display (e.g., "sk_live_abc1")
    keyHash: text('key_hash').notNull(), // Argon2 hash of full key
    permissions: text('permissions').array().default([]), // Array of permission scopes
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [
    index('api_keys_user_id_idx').on(table.userId),
    index('api_keys_key_prefix_idx').on(table.keyPrefix),
  ]
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

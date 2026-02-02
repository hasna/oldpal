import { pgTable, uuid, varchar, text, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  emailVerified: boolean('email_verified').default(false),
  passwordHash: text('password_hash'),
  name: varchar('name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  role: userRoleEnum('role').default('user').notNull(),
  googleId: varchar('google_id', { length: 255 }).unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations are defined in separate files to avoid circular imports

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

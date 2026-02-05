import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const assistants = pgTable('assistants', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  avatar: text('avatar'),
  model: varchar('model', { length: 100 }).default('claude-sonnet-4-20250514').notNull(),
  systemPrompt: text('system_prompt'),
  settings: jsonb('settings').$type<AssistantSettings>(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const assistantsRelations = relations(assistants, ({ one }) => ({
  user: one(users, {
    fields: [assistants.userId],
    references: [users.id],
  }),
}));

export interface AssistantSettings {
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
  skills?: string[];
}

export type Assistant = typeof assistants.$inferSelect;
export type NewAssistant = typeof assistants.$inferInsert;

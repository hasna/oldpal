import { pgTable, uuid, varchar, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { agents } from './agents';

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  label: varchar('label', { length: 255 }),
  cwd: text('cwd'),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').$type<SessionMetadata>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
  agent: one(agents, {
    fields: [sessions.agentId],
    references: [agents.id],
  }),
}));

export interface SessionMetadata {
  lastMessageAt?: string;
  messageCount?: number;
  context?: Record<string, unknown>;
}

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

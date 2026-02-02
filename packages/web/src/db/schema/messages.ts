import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { sessions } from './sessions';
import { users } from './users';

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system']);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => sessions.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls').$type<ToolCallData[]>(),
  toolResults: jsonb('tool_results').$type<ToolResultData[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export interface ToolCallData {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultData {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

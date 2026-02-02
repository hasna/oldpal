import { pgTable, uuid, varchar, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const messagePriorityEnum = pgEnum('message_priority', ['low', 'normal', 'high', 'urgent']);
export const messageStatusEnum = pgEnum('message_status', ['unread', 'read', 'archived', 'injected']);

export const agentMessages = pgTable('agent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull(),
  parentId: uuid('parent_id'),
  fromAgentId: uuid('from_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  toAgentId: uuid('to_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  subject: varchar('subject', { length: 500 }),
  body: text('body').notNull(),
  priority: messagePriorityEnum('priority').default('normal').notNull(),
  status: messageStatusEnum('status').default('unread').notNull(),
  readAt: timestamp('read_at'),
  injectedAt: timestamp('injected_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;

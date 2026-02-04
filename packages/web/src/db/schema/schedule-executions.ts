import { pgTable, uuid, varchar, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { schedules } from './schedules';

export const scheduleExecutions = pgTable('schedule_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id')
    .references(() => schedules.id, { onDelete: 'cascade' })
    .notNull(),
  status: varchar('status', { length: 20 }).notNull(), // 'success', 'failure', 'timeout', 'manual'
  trigger: varchar('trigger', { length: 20 }).notNull().default('scheduled'), // 'scheduled', 'manual'
  durationMs: integer('duration_ms'),
  result: jsonb('result').$type<ExecutionResult>(),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const scheduleExecutionsRelations = relations(scheduleExecutions, ({ one }) => ({
  schedule: one(schedules, {
    fields: [scheduleExecutions.scheduleId],
    references: [schedules.id],
  }),
}));

export interface ExecutionResult {
  summary?: string;
  output?: string;
  [key: string]: unknown;
}

export type ScheduleExecution = typeof scheduleExecutions.$inferSelect;
export type NewScheduleExecution = typeof scheduleExecutions.$inferInsert;

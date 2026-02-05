import { pgTable, uuid, varchar, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { assistants } from './assistants';

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  agentId: uuid('agent_id')
    .references(() => assistants.id, { onDelete: 'cascade' }),
  command: text('command').notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  scheduleKind: varchar('schedule_kind', { length: 20 }).notNull(), // once, cron, random, interval
  scheduleAt: timestamp('schedule_at'), // for 'once' kind
  scheduleCron: varchar('schedule_cron', { length: 100 }), // for 'cron' kind
  scheduleTimezone: varchar('schedule_timezone', { length: 100 }),
  scheduleMinInterval: integer('schedule_min_interval'), // for 'random' kind
  scheduleMaxInterval: integer('schedule_max_interval'), // for 'random' kind
  scheduleInterval: integer('schedule_interval'), // for 'interval' kind
  scheduleUnit: varchar('schedule_unit', { length: 20 }), // seconds, minutes, hours
  nextRunAt: timestamp('next_run_at'),
  lastRunAt: timestamp('last_run_at'),
  lastResult: jsonb('last_result').$type<ScheduleLastResult>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const schedulesRelations = relations(schedules, ({ one }) => ({
  user: one(users, {
    fields: [schedules.userId],
    references: [users.id],
  }),
  agent: one(assistants, {
    fields: [schedules.agentId],
    references: [assistants.id],
  }),
}));

export interface ScheduleLastResult {
  ok: boolean;
  summary?: string;
  error?: string;
  completedAt?: string;
}

export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;

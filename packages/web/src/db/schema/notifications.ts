import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const notificationTypeEnum = pgEnum('notification_type', [
  'message_received',
  'schedule_completed',
  'schedule_failed',
  'usage_warning',
  'usage_exceeded',
  'subscription_changed',
  'system',
]);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: notificationTypeEnum('type').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    link: varchar('link', { length: 500 }), // Optional link to navigate to
    isRead: boolean('is_read').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('notifications_user_unread_idx').on(table.userId, table.isRead),
    index('notifications_user_created_idx').on(table.userId, table.createdAt),
  ]
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

// Notification preferences per user
export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  emailNotifications: boolean('email_notifications').default(true).notNull(),
  pushNotifications: boolean('push_notifications').default(true).notNull(),
  soundEnabled: boolean('sound_enabled').default(true).notNull(),
  // Per-type preferences (which notification types to show)
  messageReceived: boolean('message_received').default(true).notNull(),
  scheduleCompleted: boolean('schedule_completed').default(true).notNull(),
  scheduleFailed: boolean('schedule_failed').default(true).notNull(),
  usageWarning: boolean('usage_warning').default(true).notNull(),
  usageExceeded: boolean('usage_exceeded').default(true).notNull(),
  subscriptionChanged: boolean('subscription_changed').default(true).notNull(),
  system: boolean('system').default(true).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.userId],
    references: [users.id],
  }),
}));

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;

import { db } from '@/db';
import { notifications, notificationPreferences, type NotificationType, type NewNotification } from '@/db/schema';
import { eq } from 'drizzle-orm';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  link?: string;
}

// Map notification type to preference field
const typeToPreferenceField: Record<NotificationType, keyof typeof notificationPreferences.$inferSelect> = {
  message_received: 'messageReceived',
  schedule_completed: 'scheduleCompleted',
  schedule_failed: 'scheduleFailed',
  usage_warning: 'usageWarning',
  usage_exceeded: 'usageExceeded',
  subscription_changed: 'subscriptionChanged',
  system: 'system',
};

export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const { userId, type, title, message, metadata, link } = params;

  // Check user preferences
  const prefs = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.userId, userId),
  });

  // If preferences exist, check if this type is enabled
  if (prefs) {
    const prefField = typeToPreferenceField[type];
    if (prefField && prefs[prefField] === false) {
      // User has disabled this notification type
      return;
    }
  }

  // Create the notification
  await db.insert(notifications).values({
    userId,
    type,
    title,
    message,
    metadata,
    link,
  });
}

// Helper functions for common notification types
export async function notifyMessageReceived(
  userId: string,
  sessionId: string,
  preview: string
): Promise<void> {
  await createNotification({
    userId,
    type: 'message_received',
    title: 'New message received',
    message: preview.slice(0, 100) + (preview.length > 100 ? '...' : ''),
    metadata: { sessionId },
    link: `/chat?session=${sessionId}`,
  });
}

export async function notifyScheduleCompleted(
  userId: string,
  scheduleName: string,
  scheduleId: string
): Promise<void> {
  await createNotification({
    userId,
    type: 'schedule_completed',
    title: 'Schedule completed',
    message: `"${scheduleName}" ran successfully`,
    metadata: { scheduleId },
    link: `/schedules`,
  });
}

export async function notifyScheduleFailed(
  userId: string,
  scheduleName: string,
  scheduleId: string,
  error?: string
): Promise<void> {
  await createNotification({
    userId,
    type: 'schedule_failed',
    title: 'Schedule failed',
    message: `"${scheduleName}" failed${error ? `: ${error.slice(0, 100)}` : ''}`,
    metadata: { scheduleId, error },
    link: `/schedules`,
  });
}

export async function notifyUsageWarning(
  userId: string,
  resource: string,
  percentage: number
): Promise<void> {
  await createNotification({
    userId,
    type: 'usage_warning',
    title: 'Usage warning',
    message: `You've used ${Math.round(percentage)}% of your ${resource} limit`,
    metadata: { resource, percentage },
    link: '/billing',
  });
}

export async function notifyUsageExceeded(
  userId: string,
  resource: string
): Promise<void> {
  await createNotification({
    userId,
    type: 'usage_exceeded',
    title: 'Limit reached',
    message: `You've reached your ${resource} limit. Upgrade your plan for more.`,
    metadata: { resource },
    link: '/billing',
  });
}

export async function notifySubscriptionChanged(
  userId: string,
  event: 'upgraded' | 'downgraded' | 'canceled' | 'renewed',
  planName?: string
): Promise<void> {
  const messages: Record<string, string> = {
    upgraded: `Your subscription has been upgraded${planName ? ` to ${planName}` : ''}`,
    downgraded: `Your subscription has been downgraded${planName ? ` to ${planName}` : ''}`,
    canceled: 'Your subscription has been canceled',
    renewed: `Your subscription has been renewed${planName ? ` (${planName})` : ''}`,
  };

  await createNotification({
    userId,
    type: 'subscription_changed',
    title: 'Subscription update',
    message: messages[event],
    metadata: { event, planName },
    link: '/billing',
  });
}

export async function notifySystem(
  userId: string,
  title: string,
  message: string,
  link?: string
): Promise<void> {
  await createNotification({
    userId,
    type: 'system',
    title,
    message,
    link,
  });
}

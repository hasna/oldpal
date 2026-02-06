import { db } from '@/db';
import { subscriptions, subscriptionPlans, usageMetrics, assistants, sessions, schedules, messages } from '@/db/schema';
import { eq, and, gte, lte, count } from 'drizzle-orm';

export interface UsageLimits {
  maxAssistants: number;
  maxMessagesPerDay: number;
  maxSessions: number;
  maxSchedules: number; // Derived from plan or default
}

export interface CurrentUsage {
  assistants: number;
  messagesThisPeriod: number;
  sessions: number;
  schedules: number;
}

export interface UsageStatus {
  type: 'assistants' | 'messages' | 'sessions' | 'schedules';
  current: number;
  limit: number;
  percentage: number;
  status: 'ok' | 'warning' | 'critical' | 'exceeded';
}

export interface UsageOverview {
  limits: UsageLimits;
  current: CurrentUsage;
  statuses: UsageStatus[];
  warnings: UsageStatus[]; // Statuses at warning level or higher
  planName: string;
  isFreeTier: boolean;
}

// Default limits for schedules (not in plan schema yet)
const DEFAULT_MAX_SCHEDULES = {
  free: 5,
  pro: 50,
  enterprise: -1, // unlimited
};

function getStatusLevel(percentage: number): 'ok' | 'warning' | 'critical' | 'exceeded' {
  if (percentage >= 100) return 'exceeded';
  if (percentage >= 90) return 'critical';
  if (percentage >= 80) return 'warning';
  return 'ok';
}

function calculateStatus(
  type: UsageStatus['type'],
  current: number,
  limit: number
): UsageStatus {
  const percentage = limit === -1 ? 0 : (current / limit) * 100;
  return {
    type,
    current,
    limit,
    percentage: Math.min(percentage, 100),
    status: limit === -1 ? 'ok' : getStatusLevel(percentage),
  };
}

export async function getUserPlanLimits(userId: string): Promise<UsageLimits & { planName: string; isFreeTier: boolean }> {
  // Get user's subscription with plan details
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
    with: {
      plan: true,
    },
  });

  if (subscription?.plan) {
    const maxSchedules = DEFAULT_MAX_SCHEDULES[subscription.plan.name as keyof typeof DEFAULT_MAX_SCHEDULES]
      ?? DEFAULT_MAX_SCHEDULES.free;

    return {
      maxAssistants: subscription.plan.maxAssistants,
      maxMessagesPerDay: subscription.plan.maxMessagesPerDay,
      maxSessions: subscription.plan.maxSessions,
      maxSchedules,
      planName: subscription.plan.displayName,
      isFreeTier: subscription.plan.name === 'free',
    };
  }

  // Default to free tier
  const freePlan = await db.query.subscriptionPlans.findFirst({
    where: eq(subscriptionPlans.name, 'free'),
  });

  if (freePlan) {
    return {
      maxAssistants: freePlan.maxAssistants,
      maxMessagesPerDay: freePlan.maxMessagesPerDay,
      maxSessions: freePlan.maxSessions,
      maxSchedules: DEFAULT_MAX_SCHEDULES.free,
      planName: freePlan.displayName,
      isFreeTier: true,
    };
  }

  // Fallback defaults if no plans in DB
  return {
    maxAssistants: 3,
    maxMessagesPerDay: 50,
    maxSessions: 10,
    maxSchedules: 5,
    planName: 'Free',
    isFreeTier: true,
  };
}

export async function getCurrentUsage(userId: string): Promise<CurrentUsage> {
  // Get start and end of today (UTC)
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

  // Count current resources
  const [assistantCount, sessionCount, scheduleCount, messagesToday] = await Promise.all([
    // Count assistants
    db.select({ count: count() }).from(assistants).where(eq(assistants.userId, userId)),

    // Count sessions
    db.select({ count: count() }).from(sessions).where(eq(sessions.userId, userId)),

    // Count schedules
    db.select({ count: count() }).from(schedules).where(eq(schedules.userId, userId)),

    // Count messages today (user messages only)
    db.select({ count: count() })
      .from(messages)
      .innerJoin(sessions, eq(messages.sessionId, sessions.id))
      .where(
        and(
          eq(sessions.userId, userId),
          eq(messages.role, 'user'),
          gte(messages.createdAt, startOfDay),
          lte(messages.createdAt, endOfDay)
        )
      ),
  ]);

  return {
    assistants: assistantCount[0]?.count ?? 0,
    messagesThisPeriod: messagesToday[0]?.count ?? 0,
    sessions: sessionCount[0]?.count ?? 0,
    schedules: scheduleCount[0]?.count ?? 0,
  };
}

export async function getUsageOverview(userId: string): Promise<UsageOverview> {
  const [limits, current] = await Promise.all([
    getUserPlanLimits(userId),
    getCurrentUsage(userId),
  ]);

  const statuses: UsageStatus[] = [
    calculateStatus('assistants', current.assistants, limits.maxAssistants),
    calculateStatus('messages', current.messagesThisPeriod, limits.maxMessagesPerDay),
    calculateStatus('sessions', current.sessions, limits.maxSessions),
    calculateStatus('schedules', current.schedules, limits.maxSchedules),
  ];

  const warnings = statuses.filter(s => s.status !== 'ok');

  return {
    limits,
    current,
    statuses,
    warnings,
    planName: limits.planName,
    isFreeTier: limits.isFreeTier,
  };
}

export async function checkCanPerformAction(
  userId: string,
  action: 'create_assistant' | 'create_session' | 'create_schedule' | 'send_message'
): Promise<{ allowed: boolean; reason?: string; currentUsage?: number; limit?: number }> {
  const [limits, current] = await Promise.all([
    getUserPlanLimits(userId),
    getCurrentUsage(userId),
  ]);

  switch (action) {
    case 'create_assistant':
      if (limits.maxAssistants !== -1 && current.assistants >= limits.maxAssistants) {
        return {
          allowed: false,
          reason: `You have reached your limit of ${limits.maxAssistants} assistants. Please upgrade your plan to create more assistants.`,
          currentUsage: current.assistants,
          limit: limits.maxAssistants,
        };
      }
      break;

    case 'create_session':
      if (limits.maxSessions !== -1 && current.sessions >= limits.maxSessions) {
        return {
          allowed: false,
          reason: `You have reached your limit of ${limits.maxSessions} sessions. Please upgrade your plan or delete existing sessions.`,
          currentUsage: current.sessions,
          limit: limits.maxSessions,
        };
      }
      break;

    case 'create_schedule':
      if (limits.maxSchedules !== -1 && current.schedules >= limits.maxSchedules) {
        return {
          allowed: false,
          reason: `You have reached your limit of ${limits.maxSchedules} schedules. Please upgrade your plan to create more schedules.`,
          currentUsage: current.schedules,
          limit: limits.maxSchedules,
        };
      }
      break;

    case 'send_message':
      if (limits.maxMessagesPerDay !== -1 && current.messagesThisPeriod >= limits.maxMessagesPerDay) {
        return {
          allowed: false,
          reason: `You have reached your daily message limit of ${limits.maxMessagesPerDay} messages. Your limit resets at midnight UTC.`,
          currentUsage: current.messagesThisPeriod,
          limit: limits.maxMessagesPerDay,
        };
      }
      break;
  }

  return { allowed: true };
}

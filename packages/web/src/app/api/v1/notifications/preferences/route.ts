import { db } from '@/db';
import { notificationPreferences } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const preferencesSchema = z.object({
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  messageReceived: z.boolean().optional(),
  scheduleCompleted: z.boolean().optional(),
  scheduleFailed: z.boolean().optional(),
  usageWarning: z.boolean().optional(),
  usageExceeded: z.boolean().optional(),
  subscriptionChanged: z.boolean().optional(),
  system: z.boolean().optional(),
});

// GET /api/v1/notifications/preferences - Get notification preferences
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;

    let prefs = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    });

    // If no preferences exist, return defaults
    if (!prefs) {
      prefs = {
        id: '',
        userId,
        emailNotifications: true,
        pushNotifications: true,
        soundEnabled: true,
        messageReceived: true,
        scheduleCompleted: true,
        scheduleFailed: true,
        usageWarning: true,
        usageExceeded: true,
        subscriptionChanged: true,
        system: true,
        updatedAt: new Date(),
      };
    }

    return successResponse({ preferences: prefs });
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/notifications/preferences - Update notification preferences
export const PATCH = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;
    const body = await request.json();
    const updates = preferencesSchema.parse(body);

    // Check if preferences exist
    const existing = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    });

    if (existing) {
      // Update existing
      await db
        .update(notificationPreferences)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(notificationPreferences.userId, userId));
    } else {
      // Create new with defaults + updates
      await db.insert(notificationPreferences).values({
        userId,
        ...updates,
      });
    }

    // Fetch updated preferences
    const prefs = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    });

    return successResponse({ preferences: prefs });
  } catch (error) {
    return errorResponse(error);
  }
});

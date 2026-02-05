import { NextRequest } from 'next/server';
import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { db } from '@/db';
import { schedules, assistants } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { ForbiddenError, NotFoundError, BadRequestError } from '@/lib/api/errors';
import { eq, and } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Compute next run time based on schedule configuration
interface ScheduleConfig {
  scheduleKind: string;
  scheduleAt?: string | null;
  scheduleInterval?: number | null;
  scheduleMinInterval?: number | null;
  scheduleMaxInterval?: number | null;
  scheduleUnit?: string | null;
  scheduleCron?: string | null;
  scheduleTimezone?: string | null;
}

function computeNextRun(schedule: ScheduleConfig): Date | null {
  const now = Date.now();

  if (schedule.scheduleKind === 'once' && schedule.scheduleAt) {
    const atTime = new Date(schedule.scheduleAt).getTime();
    return atTime > now ? new Date(atTime) : null;
  }

  if (schedule.scheduleKind === 'interval' && schedule.scheduleInterval) {
    const unit = schedule.scheduleUnit || 'minutes';
    const multiplier = unit === 'seconds' ? 1000 : unit === 'hours' ? 3600000 : 60000;
    return new Date(now + schedule.scheduleInterval * multiplier);
  }

  if (schedule.scheduleKind === 'random' && schedule.scheduleMinInterval && schedule.scheduleMaxInterval) {
    const unit = schedule.scheduleUnit || 'minutes';
    const multiplier = unit === 'seconds' ? 1000 : unit === 'hours' ? 3600000 : 60000;
    const minMs = schedule.scheduleMinInterval * multiplier;
    const maxMs = schedule.scheduleMaxInterval * multiplier;
    const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Date(now + randomDelay);
  }

  // Parse cron expression and get next execution time
  if (schedule.scheduleKind === 'cron' && schedule.scheduleCron) {
    try {
      const expression = CronExpressionParser.parse(schedule.scheduleCron, {
        currentDate: new Date(now),
        tz: schedule.scheduleTimezone || 'UTC',
      });
      return expression.next().toDate();
    } catch {
      // Invalid cron expression - return null (schedule won't run)
      return null;
    }
  }

  return null;
}

const updateScheduleSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
  command: z.string().min(1).max(1000).optional(),
  description: z.string().max(500).optional(),
  agentId: z.string().uuid().nullable().optional(),
  scheduleKind: z.enum(['once', 'cron', 'random', 'interval']).optional(),
  scheduleAt: z.string().datetime().nullable().optional(),
  scheduleCron: z.string().max(100).nullable().optional(),
  scheduleTimezone: z.string().max(100).nullable().optional(),
  scheduleMinInterval: z.number().int().positive().nullable().optional(),
  scheduleMaxInterval: z.number().int().positive().nullable().optional(),
  scheduleInterval: z.number().int().positive().nullable().optional(),
  scheduleUnit: z.enum(['seconds', 'minutes', 'hours']).nullable().optional(),
});

// GET /api/v1/schedules/[id] - Get a specific schedule
export const GET = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;

    if (!UUID_REGEX.test(id)) {
      return errorResponse(new NotFoundError('Schedule not found'));
    }

    const schedule = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), eq(schedules.userId, request.user.userId)),
      with: {
        agent: {
          columns: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    if (!schedule) {
      return errorResponse(new NotFoundError('Schedule not found'));
    }

    return successResponse(schedule);
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/schedules/[id] - Update a schedule
export const PATCH = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;

    if (!UUID_REGEX.test(id)) {
      return errorResponse(new NotFoundError('Schedule not found'));
    }

    const body = await request.json();
    const data = updateScheduleSchema.parse(body);

    // Verify ownership
    const existing = await db.query.schedules.findFirst({
      where: eq(schedules.id, id),
    });

    if (!existing) {
      return errorResponse(new NotFoundError('Schedule not found'));
    }

    if (existing.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('You do not own this schedule'));
    }

    // Verify agent ownership if agentId is being changed
    if (data.agentId !== undefined && data.agentId !== null) {
      const agent = await db.query.assistants.findFirst({
        where: eq(assistants.id, data.agentId),
      });

      if (!agent) {
        return errorResponse(new NotFoundError('Agent not found'));
      }

      if (agent.userId !== request.user.userId) {
        return errorResponse(new ForbiddenError('You do not own this agent'));
      }
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // Copy over all provided fields
    if (data.status !== undefined) updateData.status = data.status;
    if (data.command !== undefined) updateData.command = data.command;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.agentId !== undefined) updateData.agentId = data.agentId;
    if (data.scheduleKind !== undefined) updateData.scheduleKind = data.scheduleKind;
    if (data.scheduleAt !== undefined) updateData.scheduleAt = data.scheduleAt ? new Date(data.scheduleAt) : null;
    if (data.scheduleCron !== undefined) updateData.scheduleCron = data.scheduleCron;
    if (data.scheduleTimezone !== undefined) updateData.scheduleTimezone = data.scheduleTimezone;
    if (data.scheduleMinInterval !== undefined) updateData.scheduleMinInterval = data.scheduleMinInterval;
    if (data.scheduleMaxInterval !== undefined) updateData.scheduleMaxInterval = data.scheduleMaxInterval;
    if (data.scheduleInterval !== undefined) updateData.scheduleInterval = data.scheduleInterval;
    if (data.scheduleUnit !== undefined) updateData.scheduleUnit = data.scheduleUnit;

    // Recalculate nextRunAt if schedule configuration changed
    const needsRecalc = data.scheduleKind !== undefined ||
      data.scheduleAt !== undefined ||
      data.scheduleCron !== undefined ||
      data.scheduleInterval !== undefined ||
      data.scheduleMinInterval !== undefined ||
      data.scheduleMaxInterval !== undefined ||
      data.scheduleUnit !== undefined ||
      data.scheduleTimezone !== undefined;

    if (needsRecalc) {
      // Merge existing schedule with updates to get full config
      const mergedConfig: ScheduleConfig = {
        scheduleKind: (data.scheduleKind ?? existing.scheduleKind) as string,
        scheduleAt: data.scheduleAt !== undefined ? data.scheduleAt : existing.scheduleAt?.toISOString(),
        scheduleInterval: data.scheduleInterval !== undefined ? data.scheduleInterval : existing.scheduleInterval,
        scheduleMinInterval: data.scheduleMinInterval !== undefined ? data.scheduleMinInterval : existing.scheduleMinInterval,
        scheduleMaxInterval: data.scheduleMaxInterval !== undefined ? data.scheduleMaxInterval : existing.scheduleMaxInterval,
        scheduleUnit: data.scheduleUnit !== undefined ? data.scheduleUnit : existing.scheduleUnit,
        scheduleCron: data.scheduleCron !== undefined ? data.scheduleCron : existing.scheduleCron,
        scheduleTimezone: data.scheduleTimezone !== undefined ? data.scheduleTimezone : existing.scheduleTimezone,
      };
      updateData.nextRunAt = computeNextRun(mergedConfig);
    }

    // Validate schedule configuration
    const finalKind = data.scheduleKind ?? existing.scheduleKind;
    if (finalKind === 'once' && !updateData.scheduleAt && !existing.scheduleAt) {
      return errorResponse(new BadRequestError('scheduleAt is required for one-time schedules'));
    }
    if (finalKind === 'cron' && !updateData.scheduleCron && !existing.scheduleCron) {
      return errorResponse(new BadRequestError('scheduleCron is required for cron schedules'));
    }
    if (finalKind === 'interval' && !updateData.scheduleInterval && !existing.scheduleInterval) {
      return errorResponse(new BadRequestError('scheduleInterval is required for interval schedules'));
    }
    if (finalKind === 'random') {
      const minInterval = updateData.scheduleMinInterval ?? existing.scheduleMinInterval;
      const maxInterval = updateData.scheduleMaxInterval ?? existing.scheduleMaxInterval;
      if (!minInterval || !maxInterval) {
        return errorResponse(new BadRequestError('scheduleMinInterval and scheduleMaxInterval are required for random schedules'));
      }
      if (minInterval > maxInterval) {
        return errorResponse(new BadRequestError('scheduleMinInterval cannot be greater than scheduleMaxInterval'));
      }
    }

    const [updated] = await db
      .update(schedules)
      .set(updateData)
      .where(eq(schedules.id, id))
      .returning();

    return successResponse(updated);
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/schedules/[id] - Delete a schedule
export const DELETE = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;

    if (!UUID_REGEX.test(id)) {
      return errorResponse(new NotFoundError('Schedule not found'));
    }

    // Verify ownership
    const existing = await db.query.schedules.findFirst({
      where: eq(schedules.id, id),
    });

    if (!existing) {
      return errorResponse(new NotFoundError('Schedule not found'));
    }

    if (existing.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('You do not own this schedule'));
    }

    await db.delete(schedules).where(eq(schedules.id, id));

    return successResponse({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
});

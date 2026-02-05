import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import { db } from '@/db';
import { schedules, agents } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse, paginatedResponse } from '@/lib/api/response';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { eq, desc, asc, count, and, ilike } from 'drizzle-orm';

const createScheduleSchema = z.object({
  command: z.string().min(1).max(1000),
  description: z.string().max(500).optional(),
  agentId: z.string().uuid().optional(),
  scheduleKind: z.enum(['once', 'cron', 'random', 'interval']),
  scheduleAt: z.string().datetime().optional(),
  scheduleCron: z.string().max(100).optional(),
  scheduleTimezone: z.string().max(100).optional(),
  scheduleMinInterval: z.number().int().positive().optional(),
  scheduleMaxInterval: z.number().int().positive().optional(),
  scheduleInterval: z.number().int().positive().optional(),
  scheduleUnit: z.enum(['seconds', 'minutes', 'hours']).optional(),
});

// Compute next run time based on schedule configuration
function computeNextRun(schedule: z.infer<typeof createScheduleSchema>): Date | null {
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

// GET /api/v1/schedules - List user schedules
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;

    // Filter parameters
    const search = searchParams.get('search')?.trim();
    const status = searchParams.get('status');
    const scheduleKind = searchParams.get('scheduleKind');

    // Sorting parameters
    const sortBy = searchParams.get('sortBy') || 'nextRunAt';
    const sortDir = searchParams.get('sortDir') || 'desc';

    // Validate sortBy to prevent SQL injection
    const validSortColumns = ['description', 'command', 'nextRunAt', 'createdAt', 'status', 'scheduleKind'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'nextRunAt';
    const sortDirection = sortDir === 'asc' ? asc : desc;

    // Build filter conditions
    const conditions = [eq(schedules.userId, request.user.userId)];

    if (search) {
      conditions.push(
        ilike(schedules.command, `%${search}%`)
      );
    }

    if (status && (status === 'active' || status === 'paused')) {
      conditions.push(eq(schedules.status, status));
    }

    if (scheduleKind && ['once', 'cron', 'random', 'interval'].includes(scheduleKind)) {
      conditions.push(eq(schedules.scheduleKind, scheduleKind as 'once' | 'cron' | 'random' | 'interval'));
    }

    const whereClause = and(...conditions);

    // Build order by based on sort column
    const getOrderBy = () => {
      switch (sortColumn) {
        case 'description':
          return [sortDirection(schedules.description)];
        case 'command':
          return [sortDirection(schedules.command)];
        case 'createdAt':
          return [sortDirection(schedules.createdAt)];
        case 'status':
          return [sortDirection(schedules.status)];
        case 'scheduleKind':
          return [sortDirection(schedules.scheduleKind)];
        case 'nextRunAt':
        default:
          return [sortDirection(schedules.nextRunAt)];
      }
    };

    const [userSchedules, [{ total }]] = await Promise.all([
      db.query.schedules.findMany({
        where: whereClause,
        orderBy: getOrderBy(),
        limit,
        offset,
        with: {
          agent: {
            columns: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      }),
      db.select({ total: count() }).from(schedules).where(whereClause),
    ]);

    return paginatedResponse(userSchedules, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/schedules - Create a new schedule
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const body = await request.json();
    const data = createScheduleSchema.parse(body);

    // Validate schedule configuration
    if (data.scheduleKind === 'once' && !data.scheduleAt) {
      return errorResponse(new Error('scheduleAt is required for one-time schedules'));
    }
    if (data.scheduleKind === 'cron' && !data.scheduleCron) {
      return errorResponse(new Error('scheduleCron is required for cron schedules'));
    }
    if (data.scheduleKind === 'interval' && !data.scheduleInterval) {
      return errorResponse(new Error('scheduleInterval is required for interval schedules'));
    }
    if (data.scheduleKind === 'random' && (!data.scheduleMinInterval || !data.scheduleMaxInterval)) {
      return errorResponse(new Error('scheduleMinInterval and scheduleMaxInterval are required for random schedules'));
    }
    if (data.scheduleKind === 'random' && data.scheduleMinInterval! > data.scheduleMaxInterval!) {
      return errorResponse(new Error('scheduleMinInterval cannot be greater than scheduleMaxInterval'));
    }

    // Verify agent ownership if agentId is provided
    if (data.agentId) {
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, data.agentId),
      });

      if (!agent) {
        return errorResponse(new NotFoundError('Agent not found'));
      }

      if (agent.userId !== request.user.userId) {
        return errorResponse(new ForbiddenError('You do not own this agent'));
      }
    }

    const nextRunAt = computeNextRun(data);

    const [newSchedule] = await db
      .insert(schedules)
      .values({
        userId: request.user.userId,
        agentId: data.agentId,
        command: data.command,
        description: data.description,
        status: 'active',
        scheduleKind: data.scheduleKind,
        scheduleAt: data.scheduleAt ? new Date(data.scheduleAt) : null,
        scheduleCron: data.scheduleCron,
        scheduleTimezone: data.scheduleTimezone,
        scheduleMinInterval: data.scheduleMinInterval,
        scheduleMaxInterval: data.scheduleMaxInterval,
        scheduleInterval: data.scheduleInterval,
        scheduleUnit: data.scheduleUnit,
        nextRunAt,
      })
      .returning();

    return successResponse(newSchedule, 201);
  } catch (error) {
    return errorResponse(error);
  }
});

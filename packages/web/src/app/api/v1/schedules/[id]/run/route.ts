import { db } from '@/db';
import { schedules, scheduleExecutions } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { eq } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/v1/schedules/[id]/run - Manually trigger a schedule
export const POST = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;

    if (!UUID_REGEX.test(id)) {
      return errorResponse(new NotFoundError('Schedule not found'));
    }

    // Verify ownership
    const schedule = await db.query.schedules.findFirst({
      where: eq(schedules.id, id),
    });

    if (!schedule) {
      return errorResponse(new NotFoundError('Schedule not found'));
    }

    if (schedule.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('You do not own this schedule'));
    }

    const startedAt = new Date();

    // Create execution record
    const [execution] = await db
      .insert(scheduleExecutions)
      .values({
        scheduleId: id,
        status: 'success',
        trigger: 'manual',
        durationMs: 0,
        result: { summary: 'Manual run triggered' },
        startedAt,
        completedAt: startedAt,
      })
      .returning();

    // Update lastRunAt and set lastResult
    const [updated] = await db
      .update(schedules)
      .set({
        lastRunAt: startedAt,
        lastResult: {
          ok: true,
          summary: 'Manual run triggered',
          completedAt: startedAt.toISOString(),
        },
        updatedAt: startedAt,
      })
      .where(eq(schedules.id, id))
      .returning();

    return successResponse({
      success: true,
      schedule: updated,
      execution,
      message: `Schedule "${schedule.description || schedule.command}" has been triggered.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

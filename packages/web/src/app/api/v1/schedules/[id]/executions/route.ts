import { db } from '@/db';
import { schedules, scheduleExecutions } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { paginatedResponse, errorResponse } from '@/lib/api/response';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { eq, desc, count, and } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/v1/schedules/[id]/executions - Get execution history for a schedule
export const GET = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '20', 10) || 20),
      100
    );
    const offset = (page - 1) * limit;

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

    // Get executions
    const whereClause = eq(scheduleExecutions.scheduleId, id);

    const [executions, [{ total }]] = await Promise.all([
      db.query.scheduleExecutions.findMany({
        where: whereClause,
        orderBy: [desc(scheduleExecutions.startedAt)],
        limit,
        offset,
      }),
      db.select({ total: count() }).from(scheduleExecutions).where(whereClause),
    ]);

    return paginatedResponse(executions, total, page, limit);
  } catch (error) {
    return errorResponse(error);
  }
});

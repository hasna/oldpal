import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { schedules } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { eq, and } from 'drizzle-orm';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateScheduleSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
  description: z.string().max(500).optional(),
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

// PATCH /api/v1/schedules/[id] - Update a schedule (pause/resume)
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

    const [updated] = await db
      .update(schedules)
      .set({
        ...data,
        updatedAt: new Date(),
      })
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

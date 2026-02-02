import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError } from '@/lib/api/errors';
import { eq, and } from 'drizzle-orm';

const updateSessionSchema = z.object({
  label: z.string().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// GET /api/v1/sessions/:id - Get a single session
export const GET = withAuth(async (request: AuthenticatedRequest, { params }: { params: { id: string } }) => {
  try {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, params.id),
      with: {
        agent: true,
      },
    });

    if (!session) {
      return errorResponse(new NotFoundError('Session not found'));
    }

    if (session.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    return successResponse(session);
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/sessions/:id - Update a session
export const PATCH = withAuth(async (request: AuthenticatedRequest, { params }: { params: { id: string } }) => {
  try {
    const body = await request.json();
    const data = updateSessionSchema.parse(body);

    // Check ownership
    const existingSession = await db.query.sessions.findFirst({
      where: eq(sessions.id, params.id),
    });

    if (!existingSession) {
      return errorResponse(new NotFoundError('Session not found'));
    }

    if (existingSession.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    const [updatedSession] = await db
      .update(sessions)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, params.id))
      .returning();

    return successResponse(updatedSession);
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/sessions/:id - Delete a session
export const DELETE = withAuth(async (request: AuthenticatedRequest, { params }: { params: { id: string } }) => {
  try {
    // Check ownership
    const existingSession = await db.query.sessions.findFirst({
      where: eq(sessions.id, params.id),
    });

    if (!existingSession) {
      return errorResponse(new NotFoundError('Session not found'));
    }

    if (existingSession.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    await db.delete(sessions).where(eq(sessions.id, params.id));

    return successResponse({ message: 'Session deleted' });
  } catch (error) {
    return errorResponse(error);
  }
});

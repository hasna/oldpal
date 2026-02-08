import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, ForbiddenError, BadRequestError, validateUUID } from '@/lib/api/errors';
import { stopSession, closeSession } from '@/lib/server/agent-pool';
import { eq, and } from 'drizzle-orm';

const updateSessionSchema = z.object({
  label: z.string().max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

async function resolveParams(
  context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }
): Promise<Record<string, string> | undefined> {
  if (!context?.params) return undefined;
  const params = await Promise.resolve(context.params as Record<string, string>);
  return params;
}

// GET /api/v1/sessions/:id - Get a single session
export const GET = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing session id'));
    }
    validateUUID(id, 'session id');

    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, id),
      with: {
        assistant: true,
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
export const PATCH = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing session id'));
    }
    validateUUID(id, 'session id');

    const body = await request.json();
    const data = updateSessionSchema.parse(body);

    // Check ownership
    const existingSession = await db.query.sessions.findFirst({
      where: eq(sessions.id, id),
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
      .where(eq(sessions.id, id))
      .returning();

    return successResponse(updatedSession);
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/sessions/:id - Delete a session
export const DELETE = withAuth(async (request: AuthenticatedRequest, context?: { params?: Record<string, string> | Promise<Record<string, string>> | Promise<{}> }) => {
  try {
    const params = await resolveParams(context);
    const id = params?.id;
    if (!id) {
      return errorResponse(new BadRequestError('Missing session id'));
    }
    validateUUID(id, 'session id');

    // Check ownership
    const existingSession = await db.query.sessions.findFirst({
      where: eq(sessions.id, id),
    });

    if (!existingSession) {
      return errorResponse(new NotFoundError('Session not found'));
    }

    if (existingSession.userId !== request.user.userId) {
      return errorResponse(new ForbiddenError('Access denied'));
    }

    // Stop and close any active in-memory session before deleting from DB
    await stopSession(id);
    closeSession(id);

    await db.delete(sessions).where(eq(sessions.id, id));

    return successResponse({ message: 'Session deleted' });
  } catch (error) {
    return errorResponse(error);
  }
});

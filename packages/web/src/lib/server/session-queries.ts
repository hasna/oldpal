/**
 * Session query functions for the web platform
 * Implements SessionQueryFunctions interface from @hasna/assistants-core
 */

import { db } from '@/db';
import { sessions, assistants } from '@/db/schema';
import { eq, desc, and, ilike } from 'drizzle-orm';
import type {
  SessionQueryFunctions,
  AssistantSessionData,
  ListSessionsOptions,
  CreateSessionData,
  UpdateSessionData,
} from '@hasna/assistants-core';

/**
 * Convert a database session to AssistantSessionData format
 */
function toAssistantSessionData(session: typeof sessions.$inferSelect): AssistantSessionData {
  return {
    id: session.id,
    label: session.label,
    assistantId: session.assistantId,
    cwd: session.cwd,
    metadata: session.metadata,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

/**
 * Get a single session by ID
 */
async function getSession(sessionId: string, userId: string): Promise<AssistantSessionData | null> {
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
  });

  if (!session) {
    return null;
  }

  return toAssistantSessionData(session);
}

/**
 * List sessions for a user with optional filtering
 */
async function listSessions(
  userId: string,
  options: ListSessionsOptions
): Promise<AssistantSessionData[]> {
  const { limit = 20, search, assistantId } = options;

  // Build conditions
  const conditions = [eq(sessions.userId, userId)];

  if (assistantId) {
    conditions.push(eq(sessions.assistantId, assistantId));
  }

  if (search) {
    conditions.push(ilike(sessions.label, `%${search}%`));
  }

  const results = await db.query.sessions.findMany({
    where: and(...conditions),
    orderBy: [desc(sessions.updatedAt)],
    limit: Math.min(limit, 50),
  });

  return results.map(toAssistantSessionData);
}

/**
 * Create a new session
 */
async function createSession(
  userId: string,
  data: CreateSessionData
): Promise<AssistantSessionData> {
  const label = data.label || `Session ${new Date().toLocaleDateString()}`;

  const [newSession] = await db
    .insert(sessions)
    .values({
      userId,
      label,
      assistantId: data.assistantId,
      cwd: data.cwd,
      metadata: data.metadata,
    })
    .returning();

  return toAssistantSessionData(newSession);
}

/**
 * Update an existing session
 */
async function updateSession(
  sessionId: string,
  userId: string,
  data: UpdateSessionData
): Promise<AssistantSessionData | null> {
  // First verify ownership
  const existing = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
  });

  if (!existing) {
    return null;
  }

  // Merge metadata if provided
  const metadata = data.metadata
    ? { ...existing.metadata, ...data.metadata }
    : existing.metadata;

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.label !== undefined) {
    updateData.label = data.label;
  }

  if (data.metadata !== undefined) {
    updateData.metadata = metadata;
  }

  const [updated] = await db
    .update(sessions)
    .set(updateData)
    .where(eq(sessions.id, sessionId))
    .returning();

  return toAssistantSessionData(updated);
}

/**
 * Delete a session
 */
async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  // First verify ownership
  const existing = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
  });

  if (!existing) {
    return false;
  }

  // Delete the session (messages will cascade)
  await db.delete(sessions).where(eq(sessions.id, sessionId));

  return true;
}

/**
 * Verify that a user owns an assistant
 */
async function verifyAssistantOwnership(assistantId: string, userId: string): Promise<boolean> {
  const assistant = await db.query.assistants.findFirst({
    where: eq(assistants.id, assistantId),
  });

  if (!assistant) {
    return false;
  }

  return assistant.userId === userId;
}

/**
 * Create session query functions for the web platform
 */
export function createSessionQueryFunctions(): SessionQueryFunctions {
  return {
    getSession,
    listSessions,
    createSession,
    updateSession,
    deleteSession,
    verifyAssistantOwnership,
  };
}

/**
 * Singleton instance of session query functions
 */
export const sessionQueryFunctions = createSessionQueryFunctions();

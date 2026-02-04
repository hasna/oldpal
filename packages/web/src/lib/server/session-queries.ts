/**
 * Session query functions for the web platform
 * Implements SessionQueryFunctions interface from @hasna/assistants-core
 */

import { db } from '@/db';
import { sessions, agents } from '@/db/schema';
import { eq, desc, and, ilike } from 'drizzle-orm';
import type {
  SessionQueryFunctions,
  AgentSessionData,
  ListSessionsOptions,
  CreateSessionData,
  UpdateSessionData,
} from '@hasna/assistants-core';

/**
 * Convert a database session to AgentSessionData format
 */
function toAgentSessionData(session: typeof sessions.$inferSelect): AgentSessionData {
  return {
    id: session.id,
    label: session.label,
    agentId: session.agentId,
    cwd: session.cwd,
    metadata: session.metadata,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

/**
 * Get a single session by ID
 */
async function getSession(sessionId: string, userId: string): Promise<AgentSessionData | null> {
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), eq(sessions.userId, userId)),
  });

  if (!session) {
    return null;
  }

  return toAgentSessionData(session);
}

/**
 * List sessions for a user with optional filtering
 */
async function listSessions(
  userId: string,
  options: ListSessionsOptions
): Promise<AgentSessionData[]> {
  const { limit = 20, search, agentId } = options;

  // Build conditions
  const conditions = [eq(sessions.userId, userId)];

  if (agentId) {
    conditions.push(eq(sessions.agentId, agentId));
  }

  if (search) {
    conditions.push(ilike(sessions.label, `%${search}%`));
  }

  const results = await db.query.sessions.findMany({
    where: and(...conditions),
    orderBy: [desc(sessions.updatedAt)],
    limit: Math.min(limit, 50),
  });

  return results.map(toAgentSessionData);
}

/**
 * Create a new session
 */
async function createSession(
  userId: string,
  data: CreateSessionData
): Promise<AgentSessionData> {
  const label = data.label || `Session ${new Date().toLocaleDateString()}`;

  const [newSession] = await db
    .insert(sessions)
    .values({
      userId,
      label,
      agentId: data.agentId,
      cwd: data.cwd,
      metadata: data.metadata,
    })
    .returning();

  return toAgentSessionData(newSession);
}

/**
 * Update an existing session
 */
async function updateSession(
  sessionId: string,
  userId: string,
  data: UpdateSessionData
): Promise<AgentSessionData | null> {
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

  return toAgentSessionData(updated);
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
 * Verify that a user owns an agent
 */
async function verifyAgentOwnership(agentId: string, userId: string): Promise<boolean> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) {
    return false;
  }

  return agent.userId === userId;
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
    verifyAgentOwnership,
  };
}

/**
 * Singleton instance of session query functions
 */
export const sessionQueryFunctions = createSessionQueryFunctions();

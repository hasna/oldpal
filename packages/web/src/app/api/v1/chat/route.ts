import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { StreamChunk } from '@hasna/assistants-shared';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { sessions, messages } from '@/db/schema';
import { getAuthUser } from '@/lib/auth/middleware';
import { subscribeToSession, sendSessionMessage, stopSession } from '@/lib/server/agent-pool';
import type { ServerMessage } from '@/lib/protocol';
import { errorResponse } from '@/lib/api/response';
import { UnauthorizedError, NotFoundError, ForbiddenError } from '@/lib/api/errors';
import { checkRateLimit, RateLimitPresets, createUserRateLimiter } from '@/lib/rate-limit';
import { eq } from 'drizzle-orm';

// Max message length: 100KB to prevent DoS
const MAX_MESSAGE_LENGTH = 100_000;

const chatSchema = z.object({
  message: z.string().min(1, 'Message is required').max(MAX_MESSAGE_LENGTH, `Message must be at most ${MAX_MESSAGE_LENGTH} characters`),
  sessionId: z.string().uuid().optional(),
});

function encode(message: ServerMessage): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`);
}

function chunkToServerMessage(chunk: StreamChunk): ServerMessage | null {
  if (chunk.type === 'text' && chunk.content) {
    return { type: 'text_delta', content: chunk.content };
  }
  if (chunk.type === 'tool_use' && chunk.toolCall) {
    return { type: 'tool_call', id: chunk.toolCall.id, name: chunk.toolCall.name, input: chunk.toolCall.input };
  }
  if (chunk.type === 'tool_result' && chunk.toolResult) {
    return {
      type: 'tool_result',
      id: chunk.toolResult.toolCallId,
      output: chunk.toolResult.content,
      isError: !!chunk.toolResult.isError,
    };
  }
  if (chunk.type === 'done') {
    return { type: 'message_complete' };
  }
  if (chunk.type === 'error' && chunk.error) {
    return { type: 'error', message: chunk.error };
  }
  return null;
}

export async function POST(request: NextRequest) {
  // Rate limit by IP first (before auth check to catch unauthenticated abuse)
  const ipRateLimitResponse = checkRateLimit(request, 'chat', RateLimitPresets.chat);
  if (ipRateLimitResponse) return ipRateLimitResponse;

  // Authenticate user
  const user = await getAuthUser(request);
  if (!user) {
    return errorResponse(new UnauthorizedError());
  }

  // Additional per-user rate limit (30 messages per minute)
  const userRateLimitResponse = createUserRateLimiter(user.userId, 'chat', RateLimitPresets.chat);
  if (userRateLimitResponse) return userRateLimitResponse;

  try {
    const body = await request.json();
    const { message, sessionId: requestedSessionId } = chatSchema.parse(body);

    let sessionId = requestedSessionId;
    let userId = user.userId;

    // Verify session ownership or create new session
    if (sessionId) {
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
      });

      if (!session) {
        return errorResponse(new NotFoundError('Session not found'));
      }

      if (session.userId !== userId) {
        return errorResponse(new ForbiddenError('Access denied'));
      }
    } else {
      // Create a new session
      const [newSession] = await db
        .insert(sessions)
        .values({
          userId,
          label: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
        })
        .returning();
      sessionId = newSession.id;
    }

    // Save user message to database
    await db.insert(messages).values({
      sessionId,
      userId,
      role: 'user',
      content: message,
    });

    // Update session timestamp
    await db
      .update(sessions)
      .set({ updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    let unsubscribe: (() => void) | null = null;
    let closed = false;
    let controllerClosed = false;
    let assistantContent = '';
    let toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let toolResults: Array<{ toolCallId: string; content: string; isError?: boolean }> = [];

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    let assistantSaved = false;
    const saveAssistantMessage = async () => {
      if (assistantSaved) return;
      if (assistantContent || toolCalls.length > 0) {
        await db.insert(messages).values({
          sessionId: sessionId!,
          role: 'assistant',
          content: assistantContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
        });
        assistantSaved = true;
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
      },
      async cancel() {
        cleanup();
        await saveAssistantMessage();
        await stopSession(sessionId!);
      },
    });

    const enqueueSafe = (payload: Uint8Array) => {
      if (!controllerRef || controllerClosed) return;
      try {
        controllerRef.enqueue(payload);
      } catch {
        controllerClosed = true;
      }
    };

    const closeSafe = () => {
      if (!controllerRef || controllerClosed) return;
      try {
        controllerRef.close();
      } catch {
        // ignore
      } finally {
        controllerClosed = true;
      }
    };

    unsubscribe = await subscribeToSession(
      sessionId,
      async (chunk) => {
        // Collect content for saving
        if (chunk.type === 'text' && chunk.content) {
          assistantContent += chunk.content;
        }
        if (chunk.type === 'tool_use' && chunk.toolCall) {
          toolCalls.push(chunk.toolCall);
        }
        if (chunk.type === 'tool_result' && chunk.toolResult) {
          toolResults.push({
            toolCallId: chunk.toolResult.toolCallId,
            content: chunk.toolResult.content,
            isError: chunk.toolResult.isError,
          });
        }

        const serverMessage = chunkToServerMessage(chunk);
        if (serverMessage) {
          enqueueSafe(encode(serverMessage));
          if (serverMessage.type === 'message_complete') {
            await saveAssistantMessage();
            cleanup();
            closeSafe();
          }
        }
      },
      async (error) => {
        enqueueSafe(encode({ type: 'error', message: error.message }));
        await saveAssistantMessage();
        cleanup();
        closeSafe();
      }
    );

    sendSessionMessage(sessionId, message).catch(async (error) => {
      enqueueSafe(encode({ type: 'error', message: error.message }));
      await saveAssistantMessage();
      cleanup();
      closeSafe();
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Session-Id': sessionId,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

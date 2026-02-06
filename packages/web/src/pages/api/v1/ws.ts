import type { StreamChunk } from '@hasna/assistants-shared';
import type { ClientMessage, ServerMessage } from '@/lib/protocol';
import { subscribeToSession, sendSessionMessage, stopSession } from '@/lib/server/agent-pool';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { db } from '@/db';
import { sessions, messages, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { isValidUUID } from '@/lib/api/errors';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';

// Max message content length for chat messages: 100KB
const MAX_MESSAGE_LENGTH = 100_000;
// Max WebSocket payload size: 1MB (allows for JSON overhead)
const MAX_PAYLOAD_SIZE = 1_000_000;

// Rate limiting configuration
const CONNECTION_RATE_LIMIT = 10; // Max connections per IP per window
const CONNECTION_WINDOW_MS = 60_000; // 1 minute window
const MESSAGE_RATE_LIMIT = 60; // Max messages per session per window
const MESSAGE_WINDOW_MS = 60_000; // 1 minute window

// Rate limiting stores
interface RateLimitEntry {
  count: number;
  resetTime: number;
}
const connectionRateLimits = new Map<string, RateLimitEntry>();
const messageRateLimits = new Map<string, RateLimitEntry>();

// Periodic cleanup of rate limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of connectionRateLimits.entries()) {
    if (entry.resetTime < now) connectionRateLimits.delete(key);
  }
  for (const [key, entry] of messageRateLimits.entries()) {
    if (entry.resetTime < now) messageRateLimits.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Check connection rate limit for an IP address.
 * Returns true if rate limited (should reject), false if allowed.
 */
function isConnectionRateLimited(ip: string): boolean {
  const now = Date.now();
  let entry = connectionRateLimits.get(ip);

  if (!entry || entry.resetTime < now) {
    entry = { count: 1, resetTime: now + CONNECTION_WINDOW_MS };
    connectionRateLimits.set(ip, entry);
    return false;
  }

  entry.count++;
  return entry.count > CONNECTION_RATE_LIMIT;
}

/**
 * Check message rate limit for a session.
 * Returns true if rate limited (should reject), false if allowed.
 */
function isMessageRateLimited(sessionId: string): boolean {
  const now = Date.now();
  let entry = messageRateLimits.get(sessionId);

  if (!entry || entry.resetTime < now) {
    entry = { count: 1, resetTime: now + MESSAGE_WINDOW_MS };
    messageRateLimits.set(sessionId, entry);
    return false;
  }

  entry.count++;
  return entry.count > MESSAGE_RATE_LIMIT;
}

/**
 * Get client IP from request headers.
 */
function getClientIp(req: any): string {
  const forwardedFor = req?.headers?.['x-forwarded-for'];
  if (forwardedFor) {
    const firstIp = (typeof forwardedFor === 'string' ? forwardedFor : forwardedFor[0])?.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }
  const realIp = req?.headers?.['x-real-ip'];
  if (realIp) return typeof realIp === 'string' ? realIp : realIp[0];
  const cfIp = req?.headers?.['cf-connecting-ip'];
  if (cfIp) return typeof cfIp === 'string' ? cfIp : cfIp[0];
  return req?.socket?.remoteAddress || 'unknown';
}

/**
 * WebSocket user status result
 */
type WsUserStatusResult =
  | { type: 'found'; isActive: boolean }
  | { type: 'not_found' }
  | { type: 'db_error' };

/**
 * Check if a user is active (not suspended).
 * Returns user status, 'not_found' if user doesn't exist, or 'db_error' on database failure.
 */
async function getUserStatus(userId: string): Promise<WsUserStatusResult> {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { isActive: true },
    });
    if (!user) {
      return { type: 'not_found' };
    }
    return { type: 'found', isActive: user.isActive };
  } catch (error) {
    console.error(`[WS] Failed to verify user status for ${userId}:`, error);
    return { type: 'db_error' };
  }
}

/**
 * Safely parse a URL and extract its origin.
 * Returns null if the URL is invalid.
 */
function safeParseOrigin(urlString: string): string | null {
  try {
    return new URL(urlString).origin;
  } catch {
    return null;
  }
}

/**
 * Get allowed origins for WebSocket connections.
 * Sources (in order of priority):
 * 1. WS_ALLOWED_ORIGINS env var (comma-separated list of origins)
 * 2. NEXT_PUBLIC_URL env var (single URL to extract origin from)
 * 3. Development defaults (localhost ports)
 */
function getAllowedOrigins(): string[] {
  const origins: Set<string> = new Set();

  // Support explicit comma-separated allowlist via WS_ALLOWED_ORIGINS
  const allowedOriginsEnv = process.env.WS_ALLOWED_ORIGINS;
  if (allowedOriginsEnv) {
    for (const entry of allowedOriginsEnv.split(',')) {
      const trimmed = entry.trim();
      if (trimmed) {
        // Each entry should be an origin (e.g., "https://example.com")
        // Validate it's a valid URL-like format
        const parsed = safeParseOrigin(trimmed);
        if (parsed) {
          origins.add(parsed);
        } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          // If it looks like an origin but failed parsing, try adding a path
          const withPath = safeParseOrigin(`${trimmed}/`);
          if (withPath) origins.add(withPath);
        }
      }
    }
  }

  // Add NEXT_PUBLIC_URL if set (with safe parsing)
  if (process.env.NEXT_PUBLIC_URL) {
    const origin = safeParseOrigin(process.env.NEXT_PUBLIC_URL);
    if (origin) {
      origins.add(origin);
    }
  }

  // Add common development origins only in development mode
  if (process.env.NODE_ENV === 'development') {
    // Support various localhost ports commonly used in development
    const devPorts = ['3000', '3001', '7010', '7011', '8080'];
    for (const port of devPorts) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }

  return Array.from(origins);
}

function isOriginAllowed(origin: string | undefined): boolean {
  const isProduction = process.env.NODE_ENV === 'production';

  // In development with no NEXT_PUBLIC_URL or WS_ALLOWED_ORIGINS, allow all origins for convenience
  if (!isProduction && !process.env.NEXT_PUBLIC_URL && !process.env.WS_ALLOWED_ORIGINS) {
    return true;
  }

  if (!origin) {
    // Some WebSocket clients don't send Origin; reject in production, allow in development
    return !isProduction;
  }

  const allowedOrigins = getAllowedOrigins();

  // SECURITY: In production, deny by default when allowlist is empty
  if (isProduction && allowedOrigins.length === 0) {
    return false;
  }

  // In development with empty allowlist, allow all (handled above for total absence of env vars)
  if (!isProduction && allowedOrigins.length === 0) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

const sessionOwners = new Map<string, { ownerKey: string; count: number }>();

function claimSessionOwner(sessionId: string, ownerKey: string): boolean {
  const existing = sessionOwners.get(sessionId);
  if (!existing) {
    sessionOwners.set(sessionId, { ownerKey, count: 1 });
    return true;
  }
  if (existing.ownerKey !== ownerKey) {
    return false;
  }
  existing.count += 1;
  return true;
}

function releaseSessionOwner(sessionId: string, ownerKey: string): void {
  const existing = sessionOwners.get(sessionId);
  if (!existing || existing.ownerKey !== ownerKey) return;
  existing.count -= 1;
  if (existing.count <= 0) {
    sessionOwners.delete(sessionId);
  }
}

function chunkToServerMessage(chunk: StreamChunk, messageId?: string): ServerMessage | null {
  if (chunk.type === 'text' && chunk.content) {
    return { type: 'text_delta', content: chunk.content, messageId };
  }
  if (chunk.type === 'tool_use' && chunk.toolCall) {
    return {
      type: 'tool_call',
      id: chunk.toolCall.id,
      name: chunk.toolCall.name,
      input: chunk.toolCall.input,
      messageId,
    };
  }
  if (chunk.type === 'tool_result' && chunk.toolResult) {
    return {
      type: 'tool_result',
      id: chunk.toolResult.toolCallId,
      output: chunk.toolResult.content,
      isError: !!chunk.toolResult.isError,
      messageId,
    };
  }
  if (chunk.type === 'done') {
    return { type: 'message_complete', messageId };
  }
  if (chunk.type === 'error' && chunk.error) {
    return { type: 'error', message: chunk.error, messageId };
  }
  return null;
}

function sendMessage(ws: { send: (payload: string) => void; readyState?: number; OPEN?: number }, message: ServerMessage) {
  if (typeof ws.readyState === 'number') {
    const openState = typeof ws.OPEN === 'number' ? ws.OPEN : 1;
    if (ws.readyState !== openState) return;
  }
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Ignore send errors to avoid crashing the handler
  }
}

export default function handler(_req: any, res: any) {
  if (!res?.socket?.server) {
    res?.end?.();
    return;
  }

  if (!res.socket.server.wss) {
    const wss = new WebSocketServer({
      server: res.socket.server,
      maxPayload: MAX_PAYLOAD_SIZE,
    });
    res.socket.server.wss = wss;

    wss.on('connection', (ws: any, req: any) => {
      // Rate limit connections per IP
      const clientIp = getClientIp(req);
      if (isConnectionRateLimited(clientIp)) {
        ws.close(1008, 'Too many connections');
        return;
      }

      // Validate Origin header to prevent cross-site WebSocket hijacking
      const origin = req?.headers?.origin;
      if (!isOriginAllowed(origin)) {
        ws.close(1008, 'Origin not allowed');
        return;
      }

      let sessionId: string | undefined;
      let activeMessageId: string | undefined;
      let isStreamingResponse = false; // Guard against concurrent sends that would clobber messageId
      let unsubscribe: (() => void) | null = null;
      const connectionKey = `conn:${randomUUID()}`;
      const url = new URL(req?.url || '/', 'http://localhost');
      const token = url.searchParams.get('token');
      const authPromise = token ? verifyAccessToken(token) : Promise.resolve(null);
      let ownerKey: string | null = null;
      let authenticatedUserId: string | null = null;

      // Track assistant response for persistence
      let assistantContent = '';
      let toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      let toolResults: Array<{ toolCallId: string; content: string; isError?: boolean }> = [];
      let assistantSaved = false;

      const resetAssistantState = () => {
        assistantContent = '';
        toolCalls = [];
        toolResults = [];
        assistantSaved = false;
      };

      const saveAssistantMessage = async (sid: string, userId: string) => {
        if (assistantSaved) return;
        if (assistantContent || toolCalls.length > 0) {
          try {
            await db.insert(messages).values({
              sessionId: sid,
              role: 'assistant',
              content: assistantContent,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              toolResults: toolResults.length > 0 ? toolResults : undefined,
            });
            assistantSaved = true;
          } catch {
            // Ignore persistence errors to not break WebSocket flow
          }
        }
      };

      const resolveOwnerKey = async () => {
        if (ownerKey) return ownerKey;
        const auth = await authPromise;
        if (token && !auth) {
          sendMessage(ws, { type: 'error', message: 'Unauthorized' });
          ws.close(1008);
          return null;
        }
        if (auth?.userId) {
          // Check if user account is active (not suspended)
          const userStatus = await getUserStatus(auth.userId);
          if (userStatus.type === 'not_found') {
            sendMessage(ws, { type: 'error', message: 'User account not found' });
            ws.close(1008);
            return null;
          }
          if (userStatus.type === 'found' && !userStatus.isActive) {
            sendMessage(ws, { type: 'error', message: 'Account suspended' });
            ws.close(1008);
            return null;
          }
          // On db_error, fail-open: allow the connection to proceed
          // The user was authenticated via JWT, so we trust that
          authenticatedUserId = auth.userId;
          ownerKey = `user:${auth.userId}`;
        } else {
          ownerKey = connectionKey;
        }
        return ownerKey;
      };

      const ensureSubscribed = async (nextSessionId: string) => {
        if (sessionId === nextSessionId && unsubscribe) return true;
        const resolvedOwner = await resolveOwnerKey();
        if (!resolvedOwner) return false;

        // Validate session ID format to prevent injection
        if (!isValidUUID(nextSessionId)) {
          sendMessage(ws, { type: 'error', message: 'Invalid session ID format' });
          return false;
        }

        // If user is authenticated, verify they own the session in the database
        if (authenticatedUserId) {
          const session = await db.query.sessions.findFirst({
            where: eq(sessions.id, nextSessionId),
            columns: { userId: true },
          });

          if (!session) {
            // Session doesn't exist - create it for the authenticated user
            // This allows WS clients to bootstrap sessions without pre-creating via REST API
            try {
              await db.insert(sessions).values({
                id: nextSessionId,
                userId: authenticatedUserId,
                label: `Chat ${new Date().toLocaleDateString()}`,
              });
            } catch (error) {
              // Handle race conditions where session was created between check and insert
              const retrySession = await db.query.sessions.findFirst({
                where: eq(sessions.id, nextSessionId),
                columns: { userId: true },
              });
              if (!retrySession || retrySession.userId !== authenticatedUserId) {
                sendMessage(ws, { type: 'error', message: 'Failed to create session' });
                return false;
              }
            }
          } else if (session.userId !== authenticatedUserId) {
            sendMessage(ws, { type: 'error', message: 'Access denied for session' });
            return false;
          }
        }

        if (!claimSessionOwner(nextSessionId, resolvedOwner)) {
          sendMessage(ws, { type: 'error', message: 'Access denied for session' });
          return false;
        }
        if (unsubscribe) unsubscribe();
        if (sessionId && sessionId !== nextSessionId) {
          releaseSessionOwner(sessionId, resolvedOwner);
        }
        sessionId = nextSessionId;
        // Reset assistant state when subscribing to a new session
        resetAssistantState();
        unsubscribe = await subscribeToSession(
          sessionId,
          async (chunk) => {
            // Collect content for persistence (only for authenticated users)
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

            const serverMessage = chunkToServerMessage(chunk, activeMessageId);
            if (serverMessage) {
              sendMessage(ws, serverMessage);
              if (chunk.type === 'done' || chunk.type === 'error') {
                // Save assistant message for authenticated users
                if (authenticatedUserId && sessionId) {
                  await saveAssistantMessage(sessionId, authenticatedUserId);
                }
                resetAssistantState();
                activeMessageId = undefined;
                isStreamingResponse = false;
              }
            }
          },
          async (error) => {
            sendMessage(ws, { type: 'error', message: error.message, messageId: activeMessageId });
            // Save assistant message on error for authenticated users
            if (authenticatedUserId && sessionId) {
              await saveAssistantMessage(sessionId, authenticatedUserId);
            }
            resetAssistantState();
            activeMessageId = undefined;
            isStreamingResponse = false;
          }
        );
        return true;
      };

      ws.on('message', async (data: any) => {
        const resolvedOwner = await resolveOwnerKey();
        if (!resolvedOwner) return;

        // Check payload size before parsing (defense in depth - maxPayload also enforces this)
        const rawData = String(data);
        if (rawData.length > MAX_PAYLOAD_SIZE) {
          sendMessage(ws, { type: 'error', message: 'Payload too large' });
          ws.close(1009, 'Message too big'); // RFC 6455 close code for oversized payload
          return;
        }

        let message: ClientMessage;
        try {
          message = JSON.parse(rawData);
        } catch {
          sendMessage(ws, { type: 'error', message: 'Invalid JSON' });
          ws.close(1003, 'Unsupported data'); // RFC 6455 close code for unprocessable data
          return;
        }

        // Handle auth message - allows authentication without putting token in URL
        if (message.type === 'auth' && 'token' in message) {
          const authResult = await verifyAccessToken(String(message.token));
          if (authResult?.userId) {
            authenticatedUserId = authResult.userId;
            ownerKey = `user:${authResult.userId}`;
          } else {
            sendMessage(ws, { type: 'error', message: 'Invalid auth token' });
          }
          return;
        }

        if (message.type === 'session' && message.sessionId) {
          await ensureSubscribed(message.sessionId);
          return;
        }

        if (message.type === 'cancel') {
          if (sessionId) {
            await stopSession(sessionId);
          }
          // Clear streaming state since user canceled
          isStreamingResponse = false;
          activeMessageId = undefined;
          return;
        }

        if (message.type === 'message') {
          // Guard against concurrent sends - prevent messageId clobbering
          if (isStreamingResponse) {
            sendMessage(ws, { type: 'error', message: 'Please wait for the current response to complete' });
            return;
          }

          const nextSessionId = message.sessionId ?? sessionId;
          if (!nextSessionId) {
            sendMessage(ws, { type: 'error', message: 'Missing sessionId' });
            return;
          }

          // Rate limit messages per session
          if (isMessageRateLimited(nextSessionId)) {
            sendMessage(ws, { type: 'error', message: 'Rate limit exceeded. Please slow down.' });
            return;
          }

          // Validate message length to prevent DoS
          const content = String(message.content || '');
          if (content.length > MAX_MESSAGE_LENGTH) {
            sendMessage(ws, { type: 'error', message: `Message must be at most ${MAX_MESSAGE_LENGTH} characters` });
            return;
          }

          // Mark as streaming before processing to prevent concurrent sends
          isStreamingResponse = true;
          if (message.messageId) {
            activeMessageId = message.messageId;
          }
          const subscribed = await ensureSubscribed(nextSessionId);
          if (!subscribed) {
            isStreamingResponse = false;
            activeMessageId = undefined;
            return;
          }

          // Persist user message for authenticated users
          if (authenticatedUserId) {
            try {
              await db.insert(messages).values({
                sessionId: nextSessionId,
                userId: authenticatedUserId,
                role: 'user',
                content,
              });

              // Auto-generate session label from first message if not set
              const currentSession = await db.query.sessions.findFirst({
                where: eq(sessions.id, nextSessionId),
                columns: { label: true },
              });

              // Check if label is empty or matches the default "Chat date" pattern
              const hasDefaultLabel =
                !currentSession?.label ||
                currentSession.label.match(/^Chat \d{1,2}\/\d{1,2}\/\d{2,4}$/);

              if (hasDefaultLabel && content) {
                // Generate label from first ~50 chars of content
                const generatedLabel = content.slice(0, 50).trim() + (content.length > 50 ? '...' : '');
                await db
                  .update(sessions)
                  .set({ label: generatedLabel, updatedAt: new Date() })
                  .where(eq(sessions.id, nextSessionId));
              } else {
                // Just update timestamp
                await db
                  .update(sessions)
                  .set({ updatedAt: new Date() })
                  .where(eq(sessions.id, nextSessionId));
              }
            } catch {
              // Ignore persistence errors to not break WebSocket flow
            }
          }

          await sendSessionMessage(nextSessionId, content);
        }
      });

      ws.on('close', async () => {
        // Stop the session first so the assistant stops processing
        if (sessionId) {
          await stopSession(sessionId);
        }
        if (unsubscribe) unsubscribe();
        if (sessionId && ownerKey) {
          releaseSessionOwner(sessionId, ownerKey);
        }
      });
    });
  }

  res.end();
}

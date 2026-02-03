import type { StreamChunk } from '@hasna/assistants-shared';
import type { ClientMessage, ServerMessage } from '@/lib/protocol';
import { subscribeToSession, sendSessionMessage, stopSession } from '@/lib/server/agent-pool';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';

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
    const wss = new WebSocketServer({ server: res.socket.server });
    res.socket.server.wss = wss;

    wss.on('connection', (ws: any, req: any) => {
      let sessionId: string | undefined;
      let activeMessageId: string | undefined;
      let unsubscribe: (() => void) | null = null;
      const connectionKey = `conn:${randomUUID()}`;
      const url = new URL(req?.url || '/', 'http://localhost');
      const token = url.searchParams.get('token');
      const authPromise = token ? verifyAccessToken(token) : Promise.resolve(null);
      let ownerKey: string | null = null;

      const resolveOwnerKey = async () => {
        if (ownerKey) return ownerKey;
        const auth = await authPromise;
        if (token && !auth) {
          sendMessage(ws, { type: 'error', message: 'Unauthorized' });
          ws.close(1008);
          return null;
        }
        ownerKey = auth?.userId ? `user:${auth.userId}` : connectionKey;
        return ownerKey;
      };

      const ensureSubscribed = async (nextSessionId: string) => {
        if (sessionId === nextSessionId && unsubscribe) return true;
        const resolvedOwner = await resolveOwnerKey();
        if (!resolvedOwner) return false;
        if (!claimSessionOwner(nextSessionId, resolvedOwner)) {
          sendMessage(ws, { type: 'error', message: 'Access denied for session' });
          return false;
        }
        if (unsubscribe) unsubscribe();
        if (sessionId && sessionId !== nextSessionId) {
          releaseSessionOwner(sessionId, resolvedOwner);
        }
        sessionId = nextSessionId;
        unsubscribe = await subscribeToSession(
          sessionId,
          (chunk) => {
            const serverMessage = chunkToServerMessage(chunk, activeMessageId);
            if (serverMessage) {
              sendMessage(ws, serverMessage);
              if (chunk.type === 'done' || chunk.type === 'error') {
                activeMessageId = undefined;
              }
            }
          },
          (error) => {
            sendMessage(ws, { type: 'error', message: error.message, messageId: activeMessageId });
            activeMessageId = undefined;
          }
        );
        return true;
      };

      ws.on('message', async (data: any) => {
        const resolvedOwner = await resolveOwnerKey();
        if (!resolvedOwner) return;
        let message: ClientMessage;
        try {
          message = JSON.parse(String(data));
        } catch {
          sendMessage(ws, { type: 'error', message: 'Invalid JSON' });
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
          return;
        }

        if (message.type === 'message') {
          const nextSessionId = message.sessionId ?? sessionId;
          if (!nextSessionId) {
            sendMessage(ws, { type: 'error', message: 'Missing sessionId' });
            return;
          }
          if (message.messageId) {
            activeMessageId = message.messageId;
          }
          const subscribed = await ensureSubscribed(nextSessionId);
          if (!subscribed) return;
          await sendSessionMessage(nextSessionId, message.content);
        }
      });

      ws.on('close', () => {
        if (unsubscribe) unsubscribe();
        if (sessionId && ownerKey) {
          releaseSessionOwner(sessionId, ownerKey);
        }
      });
    });
  }

  res.end();
}

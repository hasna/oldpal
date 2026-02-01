import type { NextApiRequest } from 'next';
import type { Server as HTTPServer } from 'http';
import { WebSocketServer } from 'ws';
import type { StreamChunk } from '@hasna/assistants-shared';
import { randomUUID } from 'crypto';
import type { ClientMessage, ServerMessage } from '@/lib/protocol';
import { subscribeToSession, sendSessionMessage, stopSession } from '@/lib/server/agent-pool';

type NextApiResponseWithSocket = {
  socket: {
    server: HTTPServer & { wss?: WebSocketServer };
  };
};

export const config = {
  api: {
    bodyParser: false,
  },
};

function chunkToServerMessage(chunk: StreamChunk, messageId?: string | null): ServerMessage | null {
  if (chunk.type === 'text' && chunk.content) {
    return { type: 'text_delta', content: chunk.content, messageId: messageId ?? undefined };
  }
  if (chunk.type === 'tool_use' && chunk.toolCall) {
    return {
      type: 'tool_call',
      id: chunk.toolCall.id,
      name: chunk.toolCall.name,
      input: chunk.toolCall.input,
      messageId: messageId ?? undefined,
    };
  }
  if (chunk.type === 'tool_result' && chunk.toolResult) {
    return {
      type: 'tool_result',
      id: chunk.toolResult.toolCallId,
      output: chunk.toolResult.content,
      isError: !!chunk.toolResult.isError,
      messageId: messageId ?? undefined,
    };
  }
  if (chunk.type === 'done') {
    return { type: 'message_complete', messageId: messageId ?? undefined };
  }
  if (chunk.type === 'error' && chunk.error) {
    return { type: 'error', message: chunk.error, messageId: messageId ?? undefined };
  }
  return null;
}

export default function handler(req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (!res.socket.server.wss) {
    const wss = new WebSocketServer({ server: res.socket.server, path: '/api/ws' });
    res.socket.server.wss = wss;

    wss.on('connection', (ws) => {
      let sessionId = randomUUID();
      let unsubscribe: (() => void) | null = null;
      const pendingMessageIds: string[] = [];
      let currentMessageId: string | null = null;
      let suppressNextDone = false;

      const attachListener = async () => {
        if (unsubscribe) unsubscribe();
        unsubscribe = await subscribeToSession(
          sessionId,
          (chunk) => {
            if (suppressNextDone && chunk.type !== 'done' && chunk.type !== 'error') {
              suppressNextDone = false;
            }
            const suppressMapping =
              suppressNextDone && (chunk.type === 'done' || chunk.type === 'error');
            if (!suppressMapping && !currentMessageId && pendingMessageIds.length > 0) {
              currentMessageId = pendingMessageIds[0];
            }
            const message = chunkToServerMessage(chunk, suppressMapping ? null : currentMessageId);
            if (message) {
              ws.send(JSON.stringify(message));
            }
            if (chunk.type === 'done' || chunk.type === 'error') {
              if (!suppressMapping && pendingMessageIds.length > 0) {
                pendingMessageIds.shift();
              }
              currentMessageId = null;
              if (suppressMapping) {
                suppressNextDone = false;
              }
            }
          },
          (error) => {
            const suppressMapping = suppressNextDone;
            const messageId = currentMessageId ?? undefined;
            if (!suppressMapping) {
              if (currentMessageId) {
                const idx = pendingMessageIds.indexOf(currentMessageId);
                if (idx >= 0) {
                  pendingMessageIds.splice(idx, 1);
                }
                currentMessageId = null;
              } else if (pendingMessageIds.length > 0) {
                pendingMessageIds.shift();
              }
            } else {
              suppressNextDone = false;
            }
            ws.send(JSON.stringify({ type: 'error', message: error.message, messageId }));
          }
        );
      };

      const switchSession = async (nextSessionId: string) => {
        if (!nextSessionId || nextSessionId === sessionId) return;
        sessionId = nextSessionId;
        pendingMessageIds.length = 0;
        currentMessageId = null;
        suppressNextDone = false;
        await attachListener();
      };

      attachListener().catch(() => {});

      ws.on('message', async (raw) => {
        try {
          const message = JSON.parse(String(raw)) as ClientMessage;
          if (message.type === 'session' && message.sessionId) {
            await switchSession(message.sessionId);
            return;
          }

          if (message.type === 'message') {
            if (message.sessionId && message.sessionId !== sessionId) {
              await switchSession(message.sessionId);
            }
            if (message.messageId) {
              pendingMessageIds.push(message.messageId);
            }
            sendSessionMessage(sessionId, message.content).catch((error) => {
              if (message.messageId) {
                const idx = pendingMessageIds.indexOf(message.messageId);
                if (idx >= 0) {
                  pendingMessageIds.splice(idx, 1);
                }
                if (currentMessageId === message.messageId) {
                  currentMessageId = null;
                }
              }
              ws.send(JSON.stringify({
                type: 'error',
                message: error.message,
                messageId: message.messageId ?? currentMessageId ?? undefined,
              }));
            });
          }

          if (message.type === 'cancel') {
            if (currentMessageId) {
              const idx = pendingMessageIds.indexOf(currentMessageId);
              if (idx >= 0) {
                pendingMessageIds.splice(idx, 1);
              }
              currentMessageId = null;
              suppressNextDone = true;
            } else if (pendingMessageIds.length > 0) {
              pendingMessageIds.shift();
            }
            stopSession(sessionId).catch(() => {});
          }
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Invalid message' }));
        }
      });

      ws.on('close', () => {
        if (unsubscribe) {
          unsubscribe();
        }
      });
    });
  }

  res.end();
}

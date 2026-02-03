import type { StreamChunk } from '@hasna/assistants-shared';
import type { ClientMessage, ServerMessage } from '@/lib/protocol';
import { subscribeToSession, sendSessionMessage, stopSession, closeSession } from '@/lib/server/agent-pool';
import { WebSocketServer } from 'ws';

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

function sendMessage(ws: { send: (payload: string) => void }, message: ServerMessage) {
  ws.send(JSON.stringify(message));
}

export default function handler(_req: any, res: any) {
  if (!res?.socket?.server) {
    res?.end?.();
    return;
  }

  if (!res.socket.server.wss) {
    const wss = new WebSocketServer({ server: res.socket.server });
    res.socket.server.wss = wss;

    wss.on('connection', (ws: any) => {
      let sessionId: string | undefined;
      let unsubscribe: (() => void) | null = null;

      const ensureSubscribed = async (nextSessionId: string) => {
        if (sessionId === nextSessionId && unsubscribe) return;
        if (unsubscribe) unsubscribe();
        sessionId = nextSessionId;
        unsubscribe = await subscribeToSession(
          sessionId,
          (chunk) => {
            const serverMessage = chunkToServerMessage(chunk);
            if (serverMessage) {
              sendMessage(ws, serverMessage);
            }
          },
          (error) => {
            sendMessage(ws, { type: 'error', message: error.message });
          }
        );
      };

      ws.on('message', async (data: any) => {
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
          await ensureSubscribed(nextSessionId);
          await sendSessionMessage(nextSessionId, message.content);
        }
      });

      ws.on('close', () => {
        if (unsubscribe) unsubscribe();
        if (sessionId) closeSession(sessionId);
      });
    });
  }

  res.end();
}

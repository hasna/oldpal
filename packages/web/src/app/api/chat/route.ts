import type { StreamChunk } from '@hasna/assistants-shared';
import { randomUUID } from 'crypto';
import { subscribeToSession, sendSessionMessage, stopSession } from '@/lib/server/agent-pool';
import type { ServerMessage } from '@/lib/protocol';

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

export async function POST(request: Request) {
  const body = await request.json();
  const message = String(body?.message || '').trim();
  const sessionId = String(body?.sessionId || randomUUID());

  if (!message) {
    return new Response('Missing message', { status: 400 });
  }

  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    async cancel() {
      await stopSession(sessionId);
    },
  });

  const unsubscribe = await subscribeToSession(
    sessionId,
    (chunk) => {
      const serverMessage = chunkToServerMessage(chunk);
      if (serverMessage && controllerRef) {
        controllerRef.enqueue(encode(serverMessage));
        if (serverMessage.type === 'message_complete') {
          controllerRef.close();
        }
      }
    },
    (error) => {
      if (controllerRef) {
        controllerRef.enqueue(encode({ type: 'error', message: error.message }));
        controllerRef.close();
      }
    }
  );

  sendSessionMessage(sessionId, message)
    .catch((error) => {
      if (controllerRef) {
        controllerRef.enqueue(encode({ type: 'error', message: error.message }));
        controllerRef.close();
      }
    })
    .finally(() => {
      unsubscribe();
    });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

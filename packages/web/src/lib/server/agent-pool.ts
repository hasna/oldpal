import type { StreamChunk } from '@oldpal/shared';
import { EmbeddedClient } from '@oldpal/core';

type ChunkListener = (chunk: StreamChunk) => void;
type ErrorListener = (error: Error) => void;

interface SessionRecord {
  client: EmbeddedClient;
  listeners: Set<ChunkListener>;
  errorListeners: Set<ErrorListener>;
}

const sessions = new Map<string, SessionRecord>();

async function createSession(sessionId: string): Promise<SessionRecord> {
  const client = new EmbeddedClient(process.cwd(), { sessionId });
  await client.initialize();
  const record: SessionRecord = {
    client,
    listeners: new Set(),
    errorListeners: new Set(),
  };
  client.onChunk((chunk) => {
    for (const listener of record.listeners) {
      listener(chunk);
    }
  });
  client.onError((error) => {
    for (const listener of record.errorListeners) {
      listener(error);
    }
  });
  return record;
}

export async function getSession(sessionId: string): Promise<SessionRecord> {
  let record = sessions.get(sessionId);
  if (!record) {
    record = await createSession(sessionId);
    sessions.set(sessionId, record);
  }
  return record;
}

export async function subscribeToSession(
  sessionId: string,
  onChunk: ChunkListener,
  onError?: ErrorListener
): Promise<() => void> {
  const record = await getSession(sessionId);
  record.listeners.add(onChunk);
  if (onError) {
    record.errorListeners.add(onError);
  }
  return () => {
    record.listeners.delete(onChunk);
    if (onError) {
      record.errorListeners.delete(onError);
    }
  };
}

export async function sendSessionMessage(sessionId: string, message: string): Promise<void> {
  const record = await getSession(sessionId);
  await record.client.send(message);
}

export async function stopSession(sessionId: string): Promise<void> {
  const record = await getSession(sessionId);
  record.client.stop();
}

export function closeSession(sessionId: string): void {
  const record = sessions.get(sessionId);
  if (record) {
    record.client.disconnect();
    sessions.delete(sessionId);
  }
}

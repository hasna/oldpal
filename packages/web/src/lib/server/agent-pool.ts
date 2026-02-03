// Initialize Node.js runtime before any core imports
import { setRuntime, hasRuntime } from '@hasna/assistants-core';
import { nodeRuntime } from '@hasna/runtime-node';

if (!hasRuntime()) {
  setRuntime(nodeRuntime);
}

import type { StreamChunk } from '@hasna/assistants-shared';
import { EmbeddedClient } from '@hasna/assistants-core';

type ChunkListener = (chunk: StreamChunk) => void;
type ErrorListener = (error: Error) => void;

interface SessionRecord {
  client: EmbeddedClient;
  listeners: Set<ChunkListener>;
  errorListeners: Set<ErrorListener>;
  subscribers: number;
}

const sessions = new Map<string, SessionRecord>();
const pendingSessions = new Map<string, Promise<SessionRecord>>();

async function createSession(sessionId: string): Promise<SessionRecord> {
  const client = new EmbeddedClient(process.cwd(), { sessionId });
  await client.initialize();
  const record: SessionRecord = {
    client,
    listeners: new Set(),
    errorListeners: new Set(),
    subscribers: 0,
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
    let pending = pendingSessions.get(sessionId);
    if (!pending) {
      pending = createSession(sessionId);
      pendingSessions.set(sessionId, pending);
    }
    try {
      record = await pending;
      sessions.set(sessionId, record);
    } finally {
      pendingSessions.delete(sessionId);
    }
  }
  return record;
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export async function subscribeToSession(
  sessionId: string,
  onChunk: ChunkListener,
  onError?: ErrorListener
): Promise<() => void> {
  const record = await getSession(sessionId);
  record.subscribers += 1;
  record.listeners.add(onChunk);
  if (onError) {
    record.errorListeners.add(onError);
  }
  return () => {
    record.subscribers = Math.max(0, record.subscribers - 1);
    record.listeners.delete(onChunk);
    if (onError) {
      record.errorListeners.delete(onError);
    }
    if (record.subscribers === 0 && record.listeners.size === 0 && record.errorListeners.size === 0) {
      record.client.disconnect();
      sessions.delete(sessionId);
    }
  };
}

export async function sendSessionMessage(sessionId: string, message: string): Promise<void> {
  const record = await getSession(sessionId);
  await record.client.send(message);
}

export async function stopSession(sessionId: string): Promise<void> {
  // Only stop if session is already active - don't create a new session just to stop it
  const record = sessions.get(sessionId);
  if (record) {
    record.client.stop();
  }
}

export function closeSession(sessionId: string): void {
  const record = sessions.get(sessionId);
  if (record) {
    record.client.disconnect();
    sessions.delete(sessionId);
  }
}

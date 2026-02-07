import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { getMockClients, resetMockClients } from './helpers/mock-assistants-core';
import { createSchemaMock } from './helpers/mock-schema';
import { createDrizzleOrmMock } from './helpers/mock-drizzle-orm';

mock.module('@/db', () => ({
  db: {
    query: {
      sessions: {
        findFirst: async () => null,
      },
      assistants: {
        findFirst: async () => null,
      },
    },
  },
  schema: createSchemaMock(),
}));

mock.module('@/db/schema', () => createSchemaMock({
  sessions: { id: 'id', assistantId: 'assistantId' },
  assistants: { id: 'id', settings: 'settings', systemPrompt: 'systemPrompt', model: 'model', isActive: 'isActive' },
}));

mock.module('drizzle-orm', () => createDrizzleOrmMock({
  eq: (field: any, value: any) => ({ field, value }),
}));

const { getSession, subscribeToSession, sendSessionMessage, stopSession, closeSession } = await import('../src/lib/server/agent-pool');
let sessionCounter = 0;

describe('assistant pool', () => {
  beforeEach(() => {
    resetMockClients();
  });

  test('getSession caches sessions and emits chunks', async () => {
    const sessionId = `session-${++sessionCounter}`;
    const record = await getSession(sessionId);
    expect(record.client).toBeDefined();

    const recordAgain = await getSession(sessionId);
    expect(recordAgain.client).toBe(record.client);

    let received: any[] = [];
    const unsubscribe = await subscribeToSession(sessionId, (chunk) => received.push(chunk));

    const client = getMockClients().at(-1)!;
    client.emitChunk({ type: 'text', content: 'hello' });

    expect(received.length).toBe(1);
    unsubscribe();

    client.emitChunk({ type: 'text', content: 'ignored' });
    expect(received.length).toBe(1);
  });

  test('sendSessionMessage and stopSession call client', async () => {
    const sessionId = `session-${++sessionCounter}`;
    await sendSessionMessage(sessionId, 'ping');
    expect(getMockClients().at(-1)!.sent).toContain('ping');

    await stopSession(sessionId);
    expect(getMockClients().at(-1)!.stopped).toBe(true);
  });

  test('closeSession disconnects and clears record', async () => {
    const sessionId = `session-${++sessionCounter}`;
    await getSession(sessionId);
    closeSession(sessionId);
    expect(getMockClients().at(-1)!.disconnected).toBe(true);

    await getSession(sessionId);
    expect(getMockClients().length).toBe(2);
  });
});

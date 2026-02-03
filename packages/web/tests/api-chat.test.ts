import { describe, expect, test, beforeEach } from 'bun:test';
import { getMockClients, resetMockClients } from './helpers/mock-assistants-core';

const { POST } = await import('../src/app/api/chat/route');

describe('api chat route', () => {
  beforeEach(() => {
    resetMockClients();
  });

  test('returns 400 when message is missing', async () => {
    const request = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  test('streams chunks as SSE and closes on done', async () => {
    const request = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hi', sessionId: 'chat-1' }),
    });

    const response = await POST(request);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');

    const client = getMockClients().at(-1)!;
    client.emitChunk({ type: 'text', content: 'hello' });
    client.emitChunk({ type: 'done' });

    const bodyText = await new Response(response.body).text();
    expect(bodyText).toContain('text_delta');
    expect(bodyText).toContain('message_complete');
    expect(client.sent[0]).toBe('Hi');
  });

  test('streams errors from session', async () => {
    const request = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hi', sessionId: 'chat-2' }),
    });

    const response = await POST(request);

    const client = getMockClients().at(-1)!;
    client.emitError(new Error('boom'));
    const bodyText = await new Response(response.body).text();
    expect(bodyText).toContain('error');
    expect(bodyText).toContain('boom');
  });
});

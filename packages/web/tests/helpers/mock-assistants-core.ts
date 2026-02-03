import { mock } from 'bun:test';

const globalKey = '__webTestClients';
const existing = (globalThis as any)[globalKey];
const clients: any[] = Array.isArray(existing) ? existing : [];
if (!Array.isArray(existing)) {
  (globalThis as any)[globalKey] = clients;
}

class MockEmbeddedClient {
  public sent: string[] = [];
  public stopped = false;
  public disconnected = false;
  private chunkHandlers: Array<(chunk: any) => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];

  constructor(public cwd: string, public options: { sessionId?: string }) {
    clients.push(this);
  }

  async initialize() {
    return;
  }

  onChunk(cb: (chunk: any) => void) {
    this.chunkHandlers.push(cb);
  }

  onError(cb: (err: Error) => void) {
    this.errorHandlers.push(cb);
  }

  emitChunk(chunk: any) {
    for (const handler of this.chunkHandlers) {
      handler(chunk);
    }
  }

  emitError(err: Error) {
    for (const handler of this.errorHandlers) {
      handler(err);
    }
  }

  async send(message: string) {
    this.sent.push(message);
  }

  stop() {
    this.stopped = true;
  }

  disconnect() {
    this.disconnected = true;
  }
}

mock.module('@hasna/assistants-core', () => ({
  EmbeddedClient: MockEmbeddedClient,
  setRuntime: () => {},
  hasRuntime: () => true,
  getRuntime: () => null,
}));

export function getMockClients() {
  return clients as Array<InstanceType<typeof MockEmbeddedClient>>;
}

export function resetMockClients() {
  clients.length = 0;
}

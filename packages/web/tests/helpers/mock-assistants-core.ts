import { mock } from 'bun:test';

const globalKey = '__webTestClients';
const existing = (globalThis as any)[globalKey];
const clients: any[] = Array.isArray(existing) ? existing : [];
if (!Array.isArray(existing)) {
  (globalThis as any)[globalKey] = clients;
}

const bashExecutorKey = '__mockBashExecutor';
if (!(globalThis as any)[bashExecutorKey]) {
  (globalThis as any)[bashExecutorKey] = async () => 'Command completed successfully (no output)';
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

function registerAssistantsCoreMock() {
  mock.module('@hasna/assistants-core', () => ({
    EmbeddedClient: MockEmbeddedClient,
    setRuntime: () => {},
    hasRuntime: () => true,
    getRuntime: () => null,
    BashTool: {
      executor: (input: any) => (globalThis as any)[bashExecutorKey](input),
    },
  }));
}

registerAssistantsCoreMock();

export function getMockClients() {
  registerAssistantsCoreMock();
  return clients as Array<InstanceType<typeof MockEmbeddedClient>>;
}

export function resetMockClients() {
  registerAssistantsCoreMock();
  clients.length = 0;
}

export function setMockBashExecutor(executor: (input: any) => Promise<string>) {
  registerAssistantsCoreMock();
  (globalThis as any)[bashExecutorKey] = executor;
}

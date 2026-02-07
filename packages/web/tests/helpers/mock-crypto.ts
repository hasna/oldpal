type CryptoMockOverrides = Record<string, unknown>;

function createHashMock() {
  const api = {
    update: (_data: unknown) => api,
    digest: (_encoding?: string) => 'mock-digest',
  };
  return api;
}

function createHmacMock() {
  const api = {
    update: (_data: unknown) => api,
    digest: (_encoding?: string) => 'mock-hmac',
  };
  return api;
}

export function createCryptoMock(overrides: CryptoMockOverrides = {}) {
  return {
    randomUUID: () => 'mock-uuid',
    randomBytes: (size = 32) => Buffer.alloc(size, 1),
    timingSafeEqual: (a: { length?: number } | null, b: { length?: number } | null) =>
      Boolean(a && b && a.length === b.length),
    createHash: createHashMock,
    createHmac: createHmacMock,
    ...overrides,
  };
}

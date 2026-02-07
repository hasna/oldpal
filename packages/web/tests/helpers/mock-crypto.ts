import {
  createHash as realCreateHash,
  createHmac as realCreateHmac,
  randomBytes as realRandomBytes,
  randomUUID as realRandomUUID,
  timingSafeEqual as realTimingSafeEqual,
} from 'node:crypto';

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
  const createHash = typeof realCreateHash === 'function' ? realCreateHash : createHashMock;
  const createHmac = typeof realCreateHmac === 'function' ? realCreateHmac : createHmacMock;
  const randomBytes = typeof realRandomBytes === 'function' ? realRandomBytes : ((size = 32) => Buffer.alloc(size, 1));
  const randomUUID = typeof realRandomUUID === 'function'
    ? realRandomUUID
    : (() => '123e4567-e89b-12d3-a456-426614174000');
  const timingSafeEqual = typeof realTimingSafeEqual === 'function'
    ? realTimingSafeEqual
    : ((a: { length?: number } | null, b: { length?: number } | null) =>
      Boolean(a && b && a.length === b.length));

  return {
    randomUUID,
    randomBytes,
    timingSafeEqual,
    createHash,
    createHmac,
    ...overrides,
  };
}

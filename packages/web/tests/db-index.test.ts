import { describe, expect, test, afterAll, mock } from 'bun:test';

// Mock the database modules to prevent actual connection
mock.module('postgres', () => {
  const mockClient = () => ({});
  return { default: mockClient };
});

mock.module('drizzle-orm/postgres-js', () => ({
  drizzle: (client: any, options: any) => ({
    _client: client,
    _schema: options?.schema,
  }),
}));

// Set DATABASE_URL before importing
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/testdb';

describe('db/index exports', () => {
  test('exports db instance', async () => {
    const mod = await import('../src/db/index');
    expect(mod.db).toBeDefined();
  });

  test('exports schema namespace', async () => {
    const mod = await import('../src/db/index');
    expect(mod.schema).toBeDefined();
    expect(typeof mod.schema).toBe('object');
  });

  test('schema includes users table', async () => {
    const mod = await import('../src/db/index');
    expect(mod.schema.users).toBeDefined();
  });

  test('schema includes sessions table', async () => {
    const mod = await import('../src/db/index');
    expect(mod.schema.sessions).toBeDefined();
  });

  test('schema includes messages table', async () => {
    const mod = await import('../src/db/index');
    expect(mod.schema.messages).toBeDefined();
  });

  test('schema includes assistants table', async () => {
    const mod = await import('../src/db/index');
    expect(mod.schema.assistants).toBeDefined();
  });

  test('schema includes refreshTokens table', async () => {
    const mod = await import('../src/db/index');
    expect(mod.schema.refreshTokens).toBeDefined();
  });

  test('schema includes assistantMessages table', async () => {
    const mod = await import('../src/db/index');
    expect(mod.schema.assistantMessages).toBeDefined();
  });
});

afterAll(() => {
  mock.restore();
});

import { describe, expect, test } from 'bun:test';

describe('refresh-tokens schema', () => {
  test('exports refreshTokens table', async () => {
    const mod = await import('../src/db/schema/refresh-tokens');
    expect(mod.refreshTokens).toBeDefined();
  });

  test('refreshTokens has id column', async () => {
    const mod = await import('../src/db/schema/refresh-tokens');
    expect(mod.refreshTokens.id).toBeDefined();
  });

  test('refreshTokens has userId column', async () => {
    const mod = await import('../src/db/schema/refresh-tokens');
    expect(mod.refreshTokens.userId).toBeDefined();
  });

  test('refreshTokens has tokenHash column', async () => {
    const mod = await import('../src/db/schema/refresh-tokens');
    expect(mod.refreshTokens.tokenHash).toBeDefined();
  });

  test('refreshTokens has family column', async () => {
    const mod = await import('../src/db/schema/refresh-tokens');
    expect(mod.refreshTokens.family).toBeDefined();
  });

  test('refreshTokens has expiresAt column', async () => {
    const mod = await import('../src/db/schema/refresh-tokens');
    expect(mod.refreshTokens.expiresAt).toBeDefined();
  });

  test('refreshTokens has revokedAt column', async () => {
    const mod = await import('../src/db/schema/refresh-tokens');
    expect(mod.refreshTokens.revokedAt).toBeDefined();
  });

  test('refreshTokens has createdAt column', async () => {
    const mod = await import('../src/db/schema/refresh-tokens');
    expect(mod.refreshTokens.createdAt).toBeDefined();
  });

  test('refreshTokens table has correct name', async () => {
    const mod = await import('../src/db/schema/refresh-tokens');
    // @ts-ignore - accessing internal drizzle property
    expect(mod.refreshTokens[Symbol.for('drizzle:Name')]).toBe('refresh_tokens');
  });
});

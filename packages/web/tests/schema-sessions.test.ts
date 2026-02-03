import { describe, expect, test } from 'bun:test';

describe('sessions schema', () => {
  test('exports sessions table', async () => {
    const mod = await import('../src/db/schema/sessions');
    expect(mod.sessions).toBeDefined();
  });

  test('exports sessionsRelations', async () => {
    const mod = await import('../src/db/schema/sessions');
    expect(mod.sessionsRelations).toBeDefined();
  });

  test('sessions has id column', async () => {
    const mod = await import('../src/db/schema/sessions');
    expect(mod.sessions.id).toBeDefined();
  });

  test('sessions has userId column', async () => {
    const mod = await import('../src/db/schema/sessions');
    expect(mod.sessions.userId).toBeDefined();
  });

  test('sessions has label column', async () => {
    const mod = await import('../src/db/schema/sessions');
    expect(mod.sessions.label).toBeDefined();
  });

  test('sessions has cwd column', async () => {
    const mod = await import('../src/db/schema/sessions');
    expect(mod.sessions.cwd).toBeDefined();
  });

  test('sessions has agentId column', async () => {
    const mod = await import('../src/db/schema/sessions');
    expect(mod.sessions.agentId).toBeDefined();
  });

  test('sessions has metadata column', async () => {
    const mod = await import('../src/db/schema/sessions');
    expect(mod.sessions.metadata).toBeDefined();
  });

  test('sessions has createdAt column', async () => {
    const mod = await import('../src/db/schema/sessions');
    expect(mod.sessions.createdAt).toBeDefined();
  });

  test('sessions has updatedAt column', async () => {
    const mod = await import('../src/db/schema/sessions');
    expect(mod.sessions.updatedAt).toBeDefined();
  });

  test('sessions table has correct name', async () => {
    const mod = await import('../src/db/schema/sessions');
    // @ts-ignore - accessing internal drizzle property
    expect(mod.sessions[Symbol.for('drizzle:Name')]).toBe('sessions');
  });
});

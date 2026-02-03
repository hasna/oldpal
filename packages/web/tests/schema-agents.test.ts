import { describe, expect, test } from 'bun:test';

describe('agents schema', () => {
  test('exports agents table', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents).toBeDefined();
  });

  test('exports agentsRelations', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agentsRelations).toBeDefined();
  });

  test('agents has id column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.id).toBeDefined();
  });

  test('agents has userId column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.userId).toBeDefined();
  });

  test('agents has name column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.name).toBeDefined();
  });

  test('agents has description column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.description).toBeDefined();
  });

  test('agents has avatar column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.avatar).toBeDefined();
  });

  test('agents has model column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.model).toBeDefined();
  });

  test('agents has systemPrompt column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.systemPrompt).toBeDefined();
  });

  test('agents has settings column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.settings).toBeDefined();
  });

  test('agents has isActive column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.isActive).toBeDefined();
  });

  test('agents has createdAt column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.createdAt).toBeDefined();
  });

  test('agents has updatedAt column', async () => {
    const mod = await import('../src/db/schema/agents');
    expect(mod.agents.updatedAt).toBeDefined();
  });

  test('agents table has correct name', async () => {
    const mod = await import('../src/db/schema/agents');
    // @ts-ignore - accessing internal drizzle property
    expect(mod.agents[Symbol.for('drizzle:Name')]).toBe('agents');
  });
});

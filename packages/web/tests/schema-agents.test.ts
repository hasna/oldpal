import { describe, expect, test } from 'bun:test';

describe('assistants schema', () => {
  test('exports assistants table', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants).toBeDefined();
  });

  test('exports assistantsRelations', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistantsRelations).toBeDefined();
  });

  test('assistants has id column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.id).toBeDefined();
  });

  test('assistants has userId column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.userId).toBeDefined();
  });

  test('assistants has name column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.name).toBeDefined();
  });

  test('assistants has description column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.description).toBeDefined();
  });

  test('assistants has avatar column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.avatar).toBeDefined();
  });

  test('assistants has model column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.model).toBeDefined();
  });

  test('assistants has systemPrompt column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.systemPrompt).toBeDefined();
  });

  test('assistants has settings column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.settings).toBeDefined();
  });

  test('assistants has isActive column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.isActive).toBeDefined();
  });

  test('assistants has createdAt column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.createdAt).toBeDefined();
  });

  test('assistants has updatedAt column', async () => {
    const mod = await import('../src/db/schema/assistants');
    expect(mod.assistants.updatedAt).toBeDefined();
  });

  test('assistants table has correct name', async () => {
    const mod = await import('../src/db/schema/assistants');
    // @ts-ignore - accessing internal drizzle property
    expect(mod.assistants[Symbol.for('drizzle:Name')]).toBe('assistants');
  });
});

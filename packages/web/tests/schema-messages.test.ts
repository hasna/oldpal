import { describe, expect, test } from 'bun:test';

describe('messages schema', () => {
  test('exports messages table', async () => {
    const mod = await import('../src/db/schema/messages');
    expect(mod.messages).toBeDefined();
  });

  test('exports messageRoleEnum', async () => {
    const mod = await import('../src/db/schema/messages');
    expect(mod.messageRoleEnum).toBeDefined();
  });

  test('messageRoleEnum has expected values', async () => {
    const mod = await import('../src/db/schema/messages');
    const enumValues = mod.messageRoleEnum.enumValues;
    expect(enumValues).toContain('user');
    expect(enumValues).toContain('assistant');
    expect(enumValues).toContain('system');
  });

  test('messages has id column', async () => {
    const mod = await import('../src/db/schema/messages');
    expect(mod.messages.id).toBeDefined();
  });

  test('messages has sessionId column', async () => {
    const mod = await import('../src/db/schema/messages');
    expect(mod.messages.sessionId).toBeDefined();
  });

  test('messages has userId column', async () => {
    const mod = await import('../src/db/schema/messages');
    expect(mod.messages.userId).toBeDefined();
  });

  test('messages has role column', async () => {
    const mod = await import('../src/db/schema/messages');
    expect(mod.messages.role).toBeDefined();
  });

  test('messages has content column', async () => {
    const mod = await import('../src/db/schema/messages');
    expect(mod.messages.content).toBeDefined();
  });

  test('messages has toolCalls column', async () => {
    const mod = await import('../src/db/schema/messages');
    expect(mod.messages.toolCalls).toBeDefined();
  });

  test('messages has toolResults column', async () => {
    const mod = await import('../src/db/schema/messages');
    expect(mod.messages.toolResults).toBeDefined();
  });

  test('messages has createdAt column', async () => {
    const mod = await import('../src/db/schema/messages');
    expect(mod.messages.createdAt).toBeDefined();
  });

  test('messages table has correct name', async () => {
    const mod = await import('../src/db/schema/messages');
    // @ts-ignore - accessing internal drizzle property
    expect(mod.messages[Symbol.for('drizzle:Name')]).toBe('messages');
  });
});

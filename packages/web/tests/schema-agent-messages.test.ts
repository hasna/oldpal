import { describe, expect, test } from 'bun:test';

describe('assistant-messages schema', () => {
  test('exports assistantMessages table', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages).toBeDefined();
  });

  test('exports messagePriorityEnum', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.messagePriorityEnum).toBeDefined();
  });

  test('exports messageStatusEnum', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.messageStatusEnum).toBeDefined();
  });

  test('exports assistantMessagesRelations', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessagesRelations).toBeDefined();
  });

  test('messagePriorityEnum has expected values', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    const enumValues = mod.messagePriorityEnum.enumValues;
    expect(enumValues).toContain('low');
    expect(enumValues).toContain('normal');
    expect(enumValues).toContain('high');
    expect(enumValues).toContain('urgent');
  });

  test('messageStatusEnum has expected values', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    const enumValues = mod.messageStatusEnum.enumValues;
    expect(enumValues).toContain('unread');
    expect(enumValues).toContain('read');
    expect(enumValues).toContain('archived');
    expect(enumValues).toContain('injected');
  });

  test('assistantMessages has id column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.id).toBeDefined();
  });

  test('assistantMessages has threadId column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.threadId).toBeDefined();
  });

  test('assistantMessages has parentId column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.parentId).toBeDefined();
  });

  test('assistantMessages has fromAssistantId column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.fromAssistantId).toBeDefined();
  });

  test('assistantMessages has toAssistantId column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.toAssistantId).toBeDefined();
  });

  test('assistantMessages has subject column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.subject).toBeDefined();
  });

  test('assistantMessages has body column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.body).toBeDefined();
  });

  test('assistantMessages has priority column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.priority).toBeDefined();
  });

  test('assistantMessages has status column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.status).toBeDefined();
  });

  test('assistantMessages has readAt column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.readAt).toBeDefined();
  });

  test('assistantMessages has injectedAt column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.injectedAt).toBeDefined();
  });

  test('assistantMessages has createdAt column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.assistantMessages.createdAt).toBeDefined();
  });

  test('assistantMessages table has correct name', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    // @ts-ignore - accessing internal drizzle property
    expect(mod.assistantMessages[Symbol.for('drizzle:Name')]).toBe('assistant_messages');
  });
});

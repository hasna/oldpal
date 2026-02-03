import { describe, expect, test } from 'bun:test';

describe('agent-messages schema', () => {
  test('exports agentMessages table', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages).toBeDefined();
  });

  test('exports messagePriorityEnum', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.messagePriorityEnum).toBeDefined();
  });

  test('exports messageStatusEnum', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.messageStatusEnum).toBeDefined();
  });

  test('exports agentMessagesRelations', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessagesRelations).toBeDefined();
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

  test('agentMessages has id column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.id).toBeDefined();
  });

  test('agentMessages has threadId column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.threadId).toBeDefined();
  });

  test('agentMessages has parentId column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.parentId).toBeDefined();
  });

  test('agentMessages has fromAgentId column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.fromAgentId).toBeDefined();
  });

  test('agentMessages has toAgentId column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.toAgentId).toBeDefined();
  });

  test('agentMessages has subject column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.subject).toBeDefined();
  });

  test('agentMessages has body column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.body).toBeDefined();
  });

  test('agentMessages has priority column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.priority).toBeDefined();
  });

  test('agentMessages has status column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.status).toBeDefined();
  });

  test('agentMessages has readAt column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.readAt).toBeDefined();
  });

  test('agentMessages has injectedAt column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.injectedAt).toBeDefined();
  });

  test('agentMessages has createdAt column', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    expect(mod.agentMessages.createdAt).toBeDefined();
  });

  test('agentMessages table has correct name', async () => {
    const mod = await import('../src/db/schema/agent-messages');
    // @ts-ignore - accessing internal drizzle property
    expect(mod.agentMessages[Symbol.for('drizzle:Name')]).toBe('agent_messages');
  });
});

import { describe, expect, test } from 'bun:test';

describe('schema/index re-exports', () => {
  test('exports users table', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.users).toBeDefined();
  });

  test('exports userRoleEnum', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.userRoleEnum).toBeDefined();
  });

  test('exports refreshTokens table', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.refreshTokens).toBeDefined();
  });

  test('exports assistants table', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.assistants).toBeDefined();
  });

  test('exports assistantsRelations', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.assistantsRelations).toBeDefined();
  });

  test('exports sessions table', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.sessions).toBeDefined();
  });

  test('exports sessionsRelations', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.sessionsRelations).toBeDefined();
  });

  test('exports messages table', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.messages).toBeDefined();
  });

  test('exports messageRoleEnum', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.messageRoleEnum).toBeDefined();
  });

  test('exports assistantMessages table', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.assistantMessages).toBeDefined();
  });

  test('exports assistantMessagesRelations', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.assistantMessagesRelations).toBeDefined();
  });

  test('exports messagePriorityEnum', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.messagePriorityEnum).toBeDefined();
  });

  test('exports messageStatusEnum', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.messageStatusEnum).toBeDefined();
  });

  test('exports additional schema modules', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.schedules).toBeDefined();
    expect(mod.scheduleExecutions).toBeDefined();
    expect(mod.subscriptionPlans).toBeDefined();
    expect(mod.subscriptions).toBeDefined();
    expect(mod.invoices).toBeDefined();
    expect(mod.usageMetrics).toBeDefined();
    expect(mod.adminAuditLogs).toBeDefined();
    expect(mod.loginHistory).toBeDefined();
    expect(mod.notifications).toBeDefined();
    expect(mod.identities).toBeDefined();
    expect(mod.apiKeys).toBeDefined();
  });
});

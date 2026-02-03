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

  test('exports agents table', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.agents).toBeDefined();
  });

  test('exports agentsRelations', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.agentsRelations).toBeDefined();
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

  test('exports agentMessages table', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.agentMessages).toBeDefined();
  });

  test('exports agentMessagesRelations', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.agentMessagesRelations).toBeDefined();
  });

  test('exports messagePriorityEnum', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.messagePriorityEnum).toBeDefined();
  });

  test('exports messageStatusEnum', async () => {
    const mod = await import('../src/db/schema/index');
    expect(mod.messageStatusEnum).toBeDefined();
  });

  test('all 13 expected exports are present', async () => {
    const mod = await import('../src/db/schema/index');
    const exports = Object.keys(mod);
    expect(exports.length).toBe(13);
  });
});

import { describe, expect, test } from 'bun:test';

describe('users schema', () => {
  test('exports users table', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users).toBeDefined();
  });

  test('exports userRoleEnum', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.userRoleEnum).toBeDefined();
  });

  test('userRoleEnum has expected values', async () => {
    const mod = await import('../src/db/schema/users');
    const enumValues = mod.userRoleEnum.enumValues;
    expect(enumValues).toContain('user');
    expect(enumValues).toContain('admin');
  });

  test('users has id column', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users.id).toBeDefined();
  });

  test('users has email column', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users.email).toBeDefined();
  });

  test('users has emailVerified column', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users.emailVerified).toBeDefined();
  });

  test('users has passwordHash column', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users.passwordHash).toBeDefined();
  });

  test('users has name column', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users.name).toBeDefined();
  });

  test('users has avatarUrl column', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users.avatarUrl).toBeDefined();
  });

  test('users has role column', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users.role).toBeDefined();
  });

  test('users has googleId column', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users.googleId).toBeDefined();
  });

  test('users has createdAt column', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users.createdAt).toBeDefined();
  });

  test('users has updatedAt column', async () => {
    const mod = await import('../src/db/schema/users');
    expect(mod.users.updatedAt).toBeDefined();
  });

  test('users table has correct name', async () => {
    const mod = await import('../src/db/schema/users');
    // @ts-ignore - accessing internal drizzle property
    expect(mod.users[Symbol.for('drizzle:Name')]).toBe('users');
  });
});

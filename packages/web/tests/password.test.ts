import { describe, expect, test } from 'bun:test';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';

describe('password utilities', () => {
  test('hashPassword returns a hash string', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password);

    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
    expect(hash).not.toBe(password);
  });

  test('hashPassword returns different hashes for same password', async () => {
    const password = 'samePassword';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    // Argon2 includes a random salt, so hashes should differ
    expect(hash1).not.toBe(hash2);
  });

  test('hashPassword handles empty string', async () => {
    const hash = await hashPassword('');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  test('hashPassword handles unicode characters', async () => {
    const password = 'пароль123日本語🔐';
    const hash = await hashPassword(password);

    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  test('verifyPassword returns true for correct password', async () => {
    const password = 'correctPassword';
    const hash = await hashPassword(password);

    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  test('verifyPassword returns false for wrong password', async () => {
    const password = 'correctPassword';
    const hash = await hashPassword(password);

    const isValid = await verifyPassword('wrongPassword', hash);
    expect(isValid).toBe(false);
  });

  test('verifyPassword returns false for empty password against valid hash', async () => {
    const hash = await hashPassword('somePassword');

    const isValid = await verifyPassword('', hash);
    expect(isValid).toBe(false);
  });

  test('verifyPassword returns false for invalid hash format', async () => {
    const isValid = await verifyPassword('password', 'not-a-valid-hash');
    expect(isValid).toBe(false);
  });

  test('verifyPassword returns false for empty hash', async () => {
    const isValid = await verifyPassword('password', '');
    expect(isValid).toBe(false);
  });

  test('verifyPassword handles unicode passwords correctly', async () => {
    const password = 'пароль日本語🔐';
    const hash = await hashPassword(password);

    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('wrongPassword', hash)).toBe(false);
  });

  test('hash contains argon2 identifier', async () => {
    const hash = await hashPassword('testPassword');
    // Argon2 hashes start with $argon2
    expect(hash.startsWith('$argon2')).toBe(true);
  });

  test('verifyPassword is timing-safe (returns false, not error, for wrong format)', async () => {
    // Should return false gracefully, not throw
    const result = await verifyPassword('password', '$invalid$hash$format');
    expect(result).toBe(false);
  });
});

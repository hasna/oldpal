import { hashPassword, verifyPassword } from '../../src/lib/auth/password';

type PasswordMockOverrides = Record<string, unknown>;

export function createPasswordMock(overrides: PasswordMockOverrides = {}) {
  return {
    hashPassword,
    verifyPassword,
    ...overrides,
  };
}

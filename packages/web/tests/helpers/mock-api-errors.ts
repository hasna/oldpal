import * as errors from '../../src/lib/api/errors';

type ApiErrorsOverrides = Record<string, unknown>;

export function createApiErrorsMock(overrides: ApiErrorsOverrides = {}) {
  return {
    ...errors,
    ...overrides,
  };
}

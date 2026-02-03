import { describe, test } from 'bun:test';
import './helpers/mock-assistants-core';

// Silence act() environment warnings in react-test-renderer.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const message = String(args[0] ?? '');
  if (message.includes('not wrapped in act') || message.includes('react-test-renderer is deprecated')) {
    return;
  }
  originalConsoleError(...args);
};

describe('test setup', () => {
  test('loads embedded client mock', () => {
    // no-op, ensures mock is registered before other tests.
  });
});

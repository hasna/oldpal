import { describe, expect, test } from 'bun:test';
import { cn } from '../src/lib/utils';
import { init } from '../src/index';

describe('web utils', () => {
  test('cn merges classes', () => {
    const result = cn('a', false && 'b', 'c');
    expect(result).toContain('a');
    expect(result).toContain('c');
  });

  test('init is a no-op', () => {
    expect(() => init()).not.toThrow();
  });
});

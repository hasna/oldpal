import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateToolInput } from '../src/validation/schema';
import { validatePath } from '../src/validation/paths';
import { enforceMessageLimit, enforceToolOutputLimit, exceedsFileReadLimit } from '../src/validation/limits';

const sampleSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    count: { type: 'number' },
  },
  required: ['name'],
};

describe('validateToolInput', () => {
  test('should validate required fields', () => {
    const result = validateToolInput('sample', sampleSchema, { name: 'ok' });
    expect(result.valid).toBe(true);
  });

  test('should coerce types when possible', () => {
    const result = validateToolInput('sample', sampleSchema, { name: 'ok', count: '2' });
    expect(result.valid).toBe(true);
    expect(result.coerced?.count).toBe(2);
  });

  test('should reject invalid types', () => {
    const result = validateToolInput('sample', sampleSchema, { name: 123 });
    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });
});

describe('validatePath', () => {
  test('should detect path traversal outside allowed paths', async () => {
    const base = await mkdtemp(join(tmpdir(), 'oldpal-path-'));
    const result = await validatePath(join(base, '..', 'outside.txt'), { allowedPaths: [base] });
    expect(result.valid).toBe(false);
  });

  test('should block symlink pointing outside allowed paths', async () => {
    const base = await mkdtemp(join(tmpdir(), 'oldpal-path-'));
    const outside = await mkdtemp(join(tmpdir(), 'oldpal-outside-'));
    const target = join(outside, 'target.txt');
    await writeFile(target, 'hi');
    const linkPath = join(base, 'link.txt');
    await symlink(target, linkPath);

    const result = await validatePath(linkPath, { allowedPaths: [base], allowSymlinks: false });
    expect(result.valid).toBe(false);
  });
});

describe('limits', () => {
  test('should truncate messages over limit', () => {
    const message = 'x'.repeat(20);
    const truncated = enforceMessageLimit(message, 10);
    expect(truncated.length).toBeGreaterThan(0);
    expect(truncated).toContain('Truncated');
  });

  test('should truncate tool output with head/tail', () => {
    const output = 'a'.repeat(200);
    const limited = enforceToolOutputLimit(output, 50);
    expect(limited).toContain('truncated');
  });

  test('should flag file read size over limit', () => {
    expect(exceedsFileReadLimit(200, 100)).toBe(true);
    expect(exceedsFileReadLimit(50, 100)).toBe(false);
  });
});

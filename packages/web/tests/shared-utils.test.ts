import { describe, expect, test } from 'bun:test';
import {
  generateId,
  now,
  sleep,
  parseFrontmatter,
  substituteVariables,
  truncate,
  formatBytes,
  formatDuration,
} from '@hasna/assistants-shared';

describe('shared utils in web', () => {
  test('basic helpers', async () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f-]+$/);
    const before = Date.now();
    const ts = now();
    const after = Date.now();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);

    const start = Date.now();
    await sleep(1);
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });

  test('parseFrontmatter covers common cases', () => {
    const result = parseFrontmatter(`---\nname: test\nenabled: true\ncount: 3\nlist: [a, "b"]\nempty: []\nquote: "q"\n---\n\nBody`);
    expect(result.frontmatter.name).toBe('test');
    expect(result.frontmatter.enabled).toBe(true);
    expect(result.frontmatter.count).toBe(3);
    expect(result.frontmatter.list).toEqual(['a', 'b']);
    expect(result.frontmatter.empty).toEqual([]);
    expect(result.frontmatter.quote).toBe('q');
    expect(result.content).toBe('Body');

    const noFrontmatter = parseFrontmatter('Just text');
    expect(noFrontmatter.frontmatter).toEqual({});
  });

  test('substituteVariables, truncate, formatters', () => {
    const substituted = substituteVariables('$0 $ARGUMENTS ${VAR}', ['a', 'b'], { VAR: 'c' });
    expect(substituted).toBe('a a b c');
    const missing = substituteVariables('${MISSING}', [], {});
    expect(missing).toBe('');

    expect(truncate('hello', 3)).toBe('...');
    expect(truncate('hi', 5)).toBe('hi');

    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');

    expect(formatDuration(900)).toBe('900ms');
    expect(formatDuration(5000)).toBe('5.0s');
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(7200000)).toBe('2h 0m');
  });
});

import { describe, expect, test } from 'bun:test';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { withTempDir } from './fixtures/helpers';
import type { VerificationResult } from '@hasna/assistants-shared';
import { VerificationSessionStore } from '../src/sessions/verification';

const buildResult = (overrides?: Partial<VerificationResult>): VerificationResult => ({
  goalsMet: true,
  reason: 'ok',
  suggestions: ['one'],
  ...overrides,
});

describe('VerificationSessionStore', () => {
  test('creates and retrieves sessions', async () => {
    await withTempDir(async (dir) => {
      const store = new VerificationSessionStore(dir, 10);
      const session = store.create('parent-1', ['goal-1'], buildResult());
      const loaded = store.get(session.id);

      expect(loaded?.id).toBe(session.id);
      expect(loaded?.result).toBe('pass');
      expect(loaded?.parentSessionId).toBe('parent-1');
    });
  });

  test('returns null for missing or invalid session files', async () => {
    await withTempDir(async (dir) => {
      const store = new VerificationSessionStore(dir);
      expect(store.get('missing')).toBeNull();

      const badPath = join(dir, 'verifications', 'bad.json');
      await writeFile(badPath, '{ not json', 'utf-8');
      expect(store.get('bad')).toBeNull();
    });
  });

  test('lists sessions by parent and recent', async () => {
    await withTempDir(async (dir) => {
      const store = new VerificationSessionStore(dir, 10);
      const first = store.create('parent-1', ['goal-1'], buildResult());
      const second = store.create('parent-1', ['goal-2'], buildResult({ goalsMet: false }));
      const other = store.create('parent-2', ['goal-3'], buildResult());

      const byParent = store.getByParentSession('parent-1');
      expect(byParent.length).toBe(2);
      const ids = byParent.map((entry) => entry.id);
      expect(ids).toContain(first.id);
      expect(ids).toContain(second.id);

      const recent = store.listRecent(2);
      expect(recent.length).toBe(2);
      expect(recent.some((item) => item.id === other.id)).toBe(true);
    });
  });

  test('updates result and clears sessions', async () => {
    await withTempDir(async (dir) => {
      const store = new VerificationSessionStore(dir, 10);
      const session = store.create('parent-1', ['goal-1'], buildResult({ goalsMet: false }));

      store.updateResult(session.id, 'force-continue');
      const updated = store.get(session.id);
      expect(updated?.result).toBe('force-continue');

      store.clear();
      expect(store.listRecent().length).toBe(0);
    });
  });

  test('prunes old sessions beyond max count', async () => {
    await withTempDir(async (dir) => {
      const store = new VerificationSessionStore(dir, 1);
      const first = store.create('parent', ['goal-1'], buildResult());
      const second = store.create('parent', ['goal-2'], buildResult());

      const remaining = [store.get(first.id), store.get(second.id)].filter(Boolean);
      expect(remaining.length).toBe(1);
    });
  });
});

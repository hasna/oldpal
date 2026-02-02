import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { deleteProject, readProject } from '../src/projects/store';

describe('Project store', () => {
  test('rejects unsafe project ids', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-projects-'));
    try {
      const badId = '../escape';
      const read = await readProject(tempDir, badId);
      expect(read).toBeNull();
      const deleted = await deleteProject(tempDir, badId);
      expect(deleted).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

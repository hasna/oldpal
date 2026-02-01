import { dirname } from 'path';
import { mkdirSync } from 'fs';
import { readFile, writeFile, unlink } from 'fs/promises';
import type { PersistedState } from './types';

export class StatePersistence {
  private path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  async save(state: PersistedState): Promise<void> {
    try {
      await writeFile(this.path, JSON.stringify(state, null, 2));
    } catch {
      // ignore persistence errors
    }
  }

  async load(): Promise<PersistedState | null> {
    try {
      const content = await readFile(this.path, 'utf-8');
      return JSON.parse(content) as PersistedState;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch {
      // ignore missing file
    }
  }
}

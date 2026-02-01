import { dirname } from 'path';
import { mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import type { EnergyState } from './types';

export class EnergyStorage {
  private path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  async save(state: EnergyState): Promise<void> {
    try {
      await writeFile(this.path, JSON.stringify(state, null, 2));
    } catch {
      // ignore persistence errors
    }
  }

  async load(): Promise<EnergyState | null> {
    try {
      const content = await readFile(this.path, 'utf-8');
      return JSON.parse(content) as EnergyState;
    } catch {
      return null;
    }
  }
}

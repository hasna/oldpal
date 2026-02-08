/**
 * PeopleStore - File-based storage for people
 *
 * Follows the AssistantManager pattern:
 * - Directory: ~/.assistants/people/
 * - Files: index.json (list), active.json (current person), {personId}/config.json
 */

import { existsSync } from 'fs';
import { mkdir, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { generateId } from '@hasna/assistants-shared';
import { getConfigDir } from '../config';
import type { Person, PersonListItem } from './types';

/**
 * Pattern for safe IDs
 */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && SAFE_ID_PATTERN.test(id);
}

function validateId(id: string): void {
  if (!isValidId(id)) {
    throw new Error(
      `Invalid person ID: "${id}" contains invalid characters.`
    );
  }
}

interface PeopleIndex {
  people: string[];
}

interface ActivePerson {
  personId: string | null;
}

export class PeopleStore {
  private basePath: string;
  private people: Map<string, Person> = new Map();
  private activeId: string | null = null;

  constructor(basePath?: string) {
    this.basePath = basePath || join(getConfigDir(), 'people');
  }

  private get indexPath(): string {
    return join(this.basePath, 'index.json');
  }

  private get activePath(): string {
    return join(this.basePath, 'active.json');
  }

  private personConfigPath(id: string): string {
    validateId(id);
    return join(this.basePath, id, 'config.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });

    const index = await this.readIndex();
    for (const id of index.people) {
      const person = await this.readPerson(id);
      if (person) {
        this.people.set(id, person);
      }
    }

    this.activeId = await this.readActive();
  }

  // ============================================
  // CRUD
  // ============================================

  async create(name: string, email?: string, avatar?: string): Promise<Person> {
    const id = `person_${generateId().slice(0, 12)}`;
    const now = new Date().toISOString();
    const person: Person = {
      id,
      name,
      email,
      avatar,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.persist(person);
    this.people.set(id, person);
    await this.appendToIndex(id);
    return person;
  }

  async update(id: string, updates: Partial<Omit<Person, 'id' | 'createdAt'>>): Promise<Person> {
    const existing = this.people.get(id);
    if (!existing) {
      throw new Error(`Person ${id} not found`);
    }
    const updated: Person = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(updated);
    this.people.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    validateId(id);
    const dir = join(this.basePath, id);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true });
    }
    this.people.delete(id);
    await this.removeFromIndex(id);

    if (this.activeId === id) {
      await this.setActive(null);
    }
  }

  get(id: string): Person | null {
    return this.people.get(id) || null;
  }

  getByName(name: string): Person | null {
    const lower = name.toLowerCase();
    for (const person of this.people.values()) {
      if (person.name.toLowerCase() === lower) {
        return person;
      }
    }
    return null;
  }

  /**
   * Resolve a person by name or ID
   */
  resolve(nameOrId: string): Person | null {
    return this.get(nameOrId) || this.getByName(nameOrId);
  }

  list(): PersonListItem[] {
    return Array.from(this.people.values()).map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      status: p.status,
      isActive: p.id === this.activeId,
    }));
  }

  // ============================================
  // Active Person
  // ============================================

  getActive(): Person | null {
    if (!this.activeId) return null;
    return this.people.get(this.activeId) || null;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  async setActive(id: string | null): Promise<void> {
    if (id !== null) {
      const person = this.people.get(id);
      if (!person) {
        throw new Error(`Person ${id} not found`);
      }
    }
    this.activeId = id;
    try {
      await writeFile(this.activePath, JSON.stringify({ personId: id }, null, 2));
    } catch {
      // Ignore write errors
    }
  }

  // ============================================
  // File I/O
  // ============================================

  private async readIndex(): Promise<PeopleIndex> {
    try {
      if (existsSync(this.indexPath)) {
        const data = await readFile(this.indexPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch {
      // Ignore read errors
    }
    return { people: [] };
  }

  private async writeIndex(index: PeopleIndex): Promise<void> {
    await writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  private async appendToIndex(id: string): Promise<void> {
    const index = await this.readIndex();
    if (!index.people.includes(id)) {
      index.people.push(id);
      await this.writeIndex(index);
    }
  }

  private async removeFromIndex(id: string): Promise<void> {
    const index = await this.readIndex();
    index.people = index.people.filter((p) => p !== id);
    await this.writeIndex(index);
  }

  private async readActive(): Promise<string | null> {
    try {
      if (existsSync(this.activePath)) {
        const data = await readFile(this.activePath, 'utf-8');
        const parsed: ActivePerson = JSON.parse(data);
        return parsed.personId;
      }
    } catch {
      // Ignore read errors
    }
    return null;
  }

  private async readPerson(id: string): Promise<Person | null> {
    try {
      validateId(id);
      const configPath = this.personConfigPath(id);
      if (existsSync(configPath)) {
        const data = await readFile(configPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch {
      // Ignore read errors
    }
    return null;
  }

  private async persist(person: Person): Promise<void> {
    const dir = join(this.basePath, person.id);
    await mkdir(dir, { recursive: true });
    await writeFile(this.personConfigPath(person.id), JSON.stringify(person, null, 2));
  }
}

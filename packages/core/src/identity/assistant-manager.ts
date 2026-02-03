import { existsSync } from 'fs';
import { mkdir, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { generateId } from '@hasna/assistants-shared';
import type { Assistant, AssistantSettings, CreateAssistantOptions } from './types';
import { IdentityManager } from './identity-manager';

interface AssistantsIndex {
  assistants: string[];
}

/**
 * Pattern for safe IDs - only alphanumeric, hyphens, and underscores allowed
 */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that an ID is safe to use in filesystem paths.
 * Returns true if valid, false otherwise.
 */
function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && SAFE_ID_PATTERN.test(id);
}

/**
 * Validate and throw if ID is invalid
 */
function validateId(id: string, idType: string): void {
  if (!isValidId(id)) {
    throw new Error(
      `Invalid ${idType}: "${id}" contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }
}

const DEFAULT_SETTINGS: AssistantSettings = {
  model: 'claude-opus-4-5',
};

export class AssistantManager {
  private basePath: string;
  private assistants: Map<string, Assistant> = new Map();
  private activeId: string | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private get assistantsRoot(): string {
    return join(this.basePath, 'assistants');
  }

  private get indexPath(): string {
    return join(this.assistantsRoot, 'index.json');
  }

  private get activePath(): string {
    return join(this.basePath, 'active.json');
  }

  private assistantConfigPath(id: string): string {
    validateId(id, 'assistantId');
    return join(this.assistantsRoot, id, 'config.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.assistantsRoot, { recursive: true });

    const index = await this.readIndex();
    for (const id of index.assistants) {
      const assistant = await this.readAssistant(id);
      if (assistant) {
        this.assistants.set(id, assistant);
      }
    }

    this.activeId = await this.readActive();
    if (!this.activeId && this.assistants.size > 0) {
      const first = [...this.assistants.keys()][0];
      await this.setActive(first);
    }
  }

  async createAssistant(options: CreateAssistantOptions): Promise<Assistant> {
    const id = generateId();
    const now = new Date().toISOString();
    const assistant: Assistant = {
      id,
      name: options.name,
      description: options.description,
      avatar: options.avatar,
      settings: { ...DEFAULT_SETTINGS, ...(options.settings || {}) },
      createdAt: now,
      updatedAt: now,
    };

    await this.persistAssistant(assistant);
    this.assistants.set(id, assistant);
    await this.appendToIndex(id);
    await this.setActive(id);
    return assistant;
  }

  async updateAssistant(id: string, updates: Partial<Assistant>): Promise<Assistant> {
    const existing = this.assistants.get(id) || (await this.readAssistant(id));
    if (!existing) {
      throw new Error(`Assistant ${id} not found`);
    }
    const updated: Assistant = {
      ...existing,
      ...updates,
      settings: { ...existing.settings, ...(updates.settings || {}) },
      updatedAt: new Date().toISOString(),
    };
    await this.persistAssistant(updated);
    this.assistants.set(id, updated);
    return updated;
  }

  async deleteAssistant(id: string): Promise<void> {
    // Validate ID to prevent path traversal on rm
    validateId(id, 'assistantId');
    if (!this.assistants.has(id)) {
      throw new Error(`Assistant ${id} not found`);
    }
    await rm(join(this.assistantsRoot, id), { recursive: true, force: true });
    this.assistants.delete(id);
    await this.removeFromIndex(id);

    if (this.activeId === id) {
      const next = this.listAssistants()[0];
      await this.setActive(next?.id || null);
    }
  }

  async switchAssistant(id: string): Promise<Assistant> {
    const assistant = this.assistants.get(id) || (await this.readAssistant(id));
    if (!assistant) {
      throw new Error(`Assistant ${id} not found`);
    }
    await this.setActive(id);
    return assistant;
  }

  getActive(): Assistant | null {
    if (!this.activeId) return null;
    return this.assistants.get(this.activeId) || null;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  listAssistants(): Assistant[] {
    return Array.from(this.assistants.values()).sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt)
    );
  }

  getIdentityManager(assistantId: string): IdentityManager {
    return new IdentityManager(assistantId, this.basePath);
  }

  private async readIndex(): Promise<AssistantsIndex> {
    if (!existsSync(this.indexPath)) {
      return { assistants: [] };
    }
    try {
      const raw = await readFile(this.indexPath, 'utf-8');
      const data = JSON.parse(raw) as AssistantsIndex;
      const assistants = Array.isArray(data.assistants) ? data.assistants : [];
      // Filter out invalid IDs to prevent path traversal from poisoned index
      return { assistants: assistants.filter(isValidId) };
    } catch {
      return { assistants: [] };
    }
  }

  private async appendToIndex(id: string): Promise<void> {
    const index = await this.readIndex();
    if (!index.assistants.includes(id)) {
      index.assistants.push(id);
    }
    await writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  private async removeFromIndex(id: string): Promise<void> {
    const index = await this.readIndex();
    index.assistants = index.assistants.filter((assistantId) => assistantId !== id);
    await writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  private async readAssistant(id: string): Promise<Assistant | null> {
    const configPath = this.assistantConfigPath(id);
    if (!existsSync(configPath)) return null;
    try {
      const raw = await readFile(configPath, 'utf-8');
      return JSON.parse(raw) as Assistant;
    } catch {
      return null;
    }
  }

  private async persistAssistant(assistant: Assistant): Promise<void> {
    // assistantConfigPath validates the ID, but also validate here for mkdir
    validateId(assistant.id, 'assistantId');
    const dir = join(this.assistantsRoot, assistant.id);
    await mkdir(dir, { recursive: true });
    await writeFile(this.assistantConfigPath(assistant.id), JSON.stringify(assistant, null, 2));
  }

  private async readActive(): Promise<string | null> {
    if (!existsSync(this.activePath)) return null;
    try {
      const raw = await readFile(this.activePath, 'utf-8');
      const data = JSON.parse(raw) as { id?: string };
      const id = data.id || null;
      // Validate ID to prevent path traversal from poisoned active.json
      if (id && !isValidId(id)) {
        return null;
      }
      return id;
    } catch {
      return null;
    }
  }

  private async setActive(id: string | null): Promise<void> {
    this.activeId = id;
    await writeFile(this.activePath, JSON.stringify({ id }, null, 2));
  }
}

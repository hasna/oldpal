import { existsSync } from 'fs';
import { mkdir, readFile, writeFile, rename, cp } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { AssistantManager } from '../identity/assistant-manager';
import type { OldpalConfig } from '@hasna/assistants-shared';

export interface MigrationResult {
  success: boolean;
  migrated: string[];
  errors: string[];
  backupPath?: string;
}

const MIGRATION_MARKER = '.migrated-from-oldpal';

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function copyIfExists(source: string, destination: string): Promise<boolean> {
  if (!existsSync(source)) return false;
  await ensureDir(join(destination, '..'));
  await cp(source, destination, { recursive: true });
  return true;
}

async function readJson<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function migrateFromOldpal(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    migrated: [],
    errors: [],
  };

  const home = homedir();
  const oldPath = join(home, '.oldpal');
  const newPath = join(home, '.assistants');

  if (!existsSync(oldPath)) {
    result.success = true;
    return result;
  }

  if (existsSync(newPath)) {
    const marker = join(newPath, 'migration', MIGRATION_MARKER);
    if (existsSync(marker)) {
      result.success = true;
      return result;
    }
    result.errors.push('Both ~/.oldpal and ~/.assistants exist. Manual merge required.');
    return result;
  }

  try {
    await ensureDir(newPath);
    await ensureDir(join(newPath, 'assistants'));
    await ensureDir(join(newPath, 'shared', 'skills'));
    await ensureDir(join(newPath, 'logs'));
    await ensureDir(join(newPath, 'migration'));

    const config = await readJson<OldpalConfig>(join(oldPath, 'settings.json'));
    if (config) {
      await writeFile(join(newPath, 'config.json'), JSON.stringify(config, null, 2));
      result.migrated.push('config.json');
    }

    if (await copyIfExists(join(oldPath, 'settings.local.json'), join(newPath, 'config.local.json'))) {
      result.migrated.push('config.local.json');
    }

    if (await copyIfExists(join(oldPath, 'hooks.json'), join(newPath, 'hooks.json'))) {
      result.migrated.push('hooks.json');
    }

    if (await copyIfExists(join(oldPath, 'commands'), join(newPath, 'commands'))) {
      result.migrated.push('commands');
    }

    if (await copyIfExists(join(oldPath, 'OLDPAL.md'), join(newPath, 'ASSISTANTS.md'))) {
      result.migrated.push('ASSISTANTS.md');
    }

    if (await copyIfExists(join(oldPath, 'skills'), join(newPath, 'shared', 'skills'))) {
      result.migrated.push('skills');
    }

    if (await copyIfExists(join(oldPath, 'logs'), join(newPath, 'logs'))) {
      result.migrated.push('logs');
    }

    // Create default assistant + identity
    const manager = new AssistantManager(newPath);
    await manager.initialize();
    const assistant = await manager.createAssistant({
      name: config?.llm?.model ? `Assistant (${config.llm.model})` : 'Default Assistant',
      settings: config?.llm
        ? {
            model: config.llm.model,
            maxTokens: config.llm.maxTokens,
          }
        : undefined,
    });

    const identityManager = manager.getIdentityManager(assistant.id);
    await identityManager.initialize();
    await identityManager.createIdentity({ name: 'Default' });

    if (await copyIfExists(join(oldPath, 'sessions'), join(newPath, 'assistants', assistant.id, 'sessions'))) {
      result.migrated.push('sessions');
    }

    await writeFile(
      join(newPath, 'migration', MIGRATION_MARKER),
      JSON.stringify({ migratedAt: new Date().toISOString() }, null, 2)
    );

    const backupPath = `${oldPath}.backup`;
    await rename(oldPath, backupPath);
    result.backupPath = backupPath;
    result.migrated.push('backup');

    result.success = true;
  } catch (error) {
    result.errors.push(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

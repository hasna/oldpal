/**
 * SharedWorkspaceManager - Manages shared workspaces for agent collaboration
 *
 * Each workspace is a directory that multiple agents can read/write to.
 * Structure:
 *   ~/.assistants/workspaces/{id}/
 *     workspace.json           - Workspace metadata
 *     shared/                  - Files shared between all participants
 *     assistants/{assistantId}/ - Per-assistant output directories
 */

import { join } from 'path';
import { homedir } from 'os';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  rmSync,
  renameSync,
} from 'fs';
import { generateId } from '@hasna/assistants-shared';
import { atomicWriteFileSync } from '../utils/atomic-write';

/**
 * Workspace metadata
 */
export interface SharedWorkspace {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  participants: string[];
  status: 'active' | 'archived';
}

/**
 * SharedWorkspaceManager - creates and manages shared workspaces
 */
export class SharedWorkspaceManager {
  private basePath: string;

  constructor(basePath?: string) {
    const envHome = process.env.HOME || process.env.USERPROFILE || homedir();
    this.basePath = basePath || join(envHome, '.assistants', 'workspaces');
    this.ensureDir();
    this.migrateAgentsToAssistants();
  }

  private ensureDir(): void {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Migrate existing workspaces from agents/ to assistants/ directory structure
   */
  private migrateAgentsToAssistants(): void {
    try {
      const dirs = readdirSync(this.basePath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const dir of dirs) {
        const wsPath = join(this.basePath, dir);
        const oldAgentsDir = join(wsPath, 'agents');
        const newAssistantsDir = join(wsPath, 'assistants');

        if (existsSync(oldAgentsDir) && !existsSync(newAssistantsDir)) {
          renameSync(oldAgentsDir, newAssistantsDir);
        }
      }
    } catch {
      // Migration is best-effort; don't fail startup
    }
  }

  private getWorkspacePath(id: string): string {
    return join(this.basePath, id);
  }

  private getMetadataPath(id: string): string {
    return join(this.getWorkspacePath(id), 'workspace.json');
  }

  /**
   * Create a new shared workspace
   */
  create(
    name: string,
    createdBy: string,
    participants: string[],
    description?: string
  ): SharedWorkspace {
    const id = `ws_${generateId().slice(0, 8)}`;
    const workspace: SharedWorkspace = {
      id,
      name,
      description,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy,
      participants: [...new Set([createdBy, ...participants])],
      status: 'active',
    };

    // Create directory structure
    const wsPath = this.getWorkspacePath(id);
    mkdirSync(join(wsPath, 'shared'), { recursive: true });

    // Create per-assistant directories
    for (const assistantId of workspace.participants) {
      mkdirSync(join(wsPath, 'assistants', assistantId), { recursive: true });
    }

    // Save metadata
    atomicWriteFileSync(this.getMetadataPath(id), JSON.stringify(workspace, null, 2));

    return workspace;
  }

  /**
   * Join an existing workspace
   */
  join(workspaceId: string, assistantId: string): void {
    const workspace = this.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    if (!workspace.participants.includes(assistantId)) {
      workspace.participants.push(assistantId);
      workspace.updatedAt = Date.now();
      atomicWriteFileSync(this.getMetadataPath(workspaceId), JSON.stringify(workspace, null, 2));
    }

    // Ensure assistant directory exists
    const assistantDir = join(this.getWorkspacePath(workspaceId), 'assistants', assistantId);
    if (!existsSync(assistantDir)) {
      mkdirSync(assistantDir, { recursive: true });
    }
  }

  /**
   * Get workspace metadata
   */
  get(workspaceId: string): SharedWorkspace | null {
    try {
      const metadataPath = this.getMetadataPath(workspaceId);
      if (!existsSync(metadataPath)) return null;
      return JSON.parse(readFileSync(metadataPath, 'utf-8')) as SharedWorkspace;
    } catch {
      return null;
    }
  }

  /**
   * Get the filesystem path for a workspace
   */
  getPath(workspaceId: string): string {
    return this.getWorkspacePath(workspaceId);
  }

  /**
   * Get the shared directory path for a workspace
   */
  getSharedPath(workspaceId: string): string {
    return join(this.getWorkspacePath(workspaceId), 'shared');
  }

  /**
   * Get an assistant's directory in a workspace
   */
  getAssistantPath(workspaceId: string, assistantId: string): string {
    return join(this.getWorkspacePath(workspaceId), 'assistants', assistantId);
  }

  /**
   * List all workspaces
   */
  list(includeArchived = false): SharedWorkspace[] {
    try {
      this.ensureDir();
      const dirs = readdirSync(this.basePath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      const workspaces: SharedWorkspace[] = [];
      for (const dir of dirs) {
        const workspace = this.get(dir);
        if (workspace) {
          if (includeArchived || workspace.status === 'active') {
            workspaces.push(workspace);
          }
        }
      }

      return workspaces.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /**
   * List workspaces that a specific agent participates in
   */
  listForAgent(assistantId: string): SharedWorkspace[] {
    return this.list().filter((ws) => ws.participants.includes(assistantId));
  }

  /**
   * Archive a workspace
   */
  archive(workspaceId: string): void {
    const workspace = this.get(workspaceId);
    if (workspace) {
      workspace.status = 'archived';
      workspace.updatedAt = Date.now();
      atomicWriteFileSync(this.getMetadataPath(workspaceId), JSON.stringify(workspace, null, 2));
    }
  }

  /**
   * Delete a workspace and all its contents
   */
  delete(workspaceId: string): void {
    const wsPath = this.getWorkspacePath(workspaceId);
    if (existsSync(wsPath)) {
      rmSync(wsPath, { recursive: true, force: true });
    }
  }
}

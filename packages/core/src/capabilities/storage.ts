/**
 * Capability Storage
 *
 * Provides persistence and loading for agent capabilities.
 * Supports both file-based storage and in-memory caching.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { CapabilitiesConfigShared } from '@hasna/assistants-shared';
import type {
  AgentCapabilitySet,
  CapabilityChain,
  CapabilityScope,
  OrchestrationLevel,
  ToolAccessPolicy,
} from './types';
import {
  DEFAULT_CAPABILITY_SET,
  ORCHESTRATION_DEFAULTS,
  RESTRICTED_CAPABILITY_SET,
  COORDINATOR_CAPABILITY_SET,
} from './types';

/**
 * Storage configuration
 */
export interface CapabilityStorageConfig {
  /** Whether storage is enabled */
  enabled: boolean;
  /** Storage directory path */
  storagePath?: string;
  /** Auto-save on changes */
  autoSave: boolean;
}

/**
 * Default storage configuration
 */
export const DEFAULT_STORAGE_CONFIG: CapabilityStorageConfig = {
  enabled: true,
  autoSave: true,
};

/**
 * Stored capability data format
 */
interface StoredCapabilities {
  version: number;
  savedAt: string;
  chains: Record<string, CapabilityChain>;
  overrides: Record<string, Partial<AgentCapabilitySet>>;
}

/**
 * Capability Storage class
 */
export class CapabilityStorage {
  private config: CapabilityStorageConfig;
  private chains: Map<string, CapabilityChain> = new Map();
  private overrides: Map<string, Partial<AgentCapabilitySet>> = new Map();
  private dirty = false;

  constructor(config?: Partial<CapabilityStorageConfig>) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
    this.load();
  }

  /**
   * Get storage file path
   */
  private getStoragePath(): string {
    if (this.config.storagePath) {
      return this.config.storagePath;
    }
    const home = process.env.HOME || process.env.USERPROFILE || homedir();
    return join(home, '.assistants', 'capabilities', 'store.json');
  }

  /**
   * Load capabilities from storage
   */
  private load(): void {
    if (!this.config.enabled) return;

    try {
      const path = this.getStoragePath();
      if (!existsSync(path)) return;

      const data = JSON.parse(readFileSync(path, 'utf-8')) as StoredCapabilities;

      if (data.chains) {
        for (const [id, chain] of Object.entries(data.chains)) {
          this.chains.set(id, chain);
        }
      }

      if (data.overrides) {
        for (const [id, override] of Object.entries(data.overrides)) {
          this.overrides.set(id, override);
        }
      }
    } catch {
      // Failed to load, start fresh
    }
  }

  /**
   * Save capabilities to storage
   */
  save(): void {
    if (!this.config.enabled) return;

    try {
      const path = this.getStoragePath();
      const dir = dirname(path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: StoredCapabilities = {
        version: 1,
        savedAt: new Date().toISOString(),
        chains: Object.fromEntries(this.chains),
        overrides: Object.fromEntries(this.overrides),
      };

      writeFileSync(path, JSON.stringify(data, null, 2));
      this.dirty = false;
    } catch {
      // Failed to save, non-critical
    }
  }

  /**
   * Auto-save if enabled
   */
  private autoSave(): void {
    if (this.config.autoSave && this.dirty) {
      this.save();
    }
  }

  /**
   * Get capability chain for an entity
   */
  getChain(entityId: string): CapabilityChain | null {
    return this.chains.get(entityId) || null;
  }

  /**
   * Set capability chain for an entity
   */
  setChain(entityId: string, chain: CapabilityChain): void {
    this.chains.set(entityId, chain);
    this.dirty = true;
    this.autoSave();
  }

  /**
   * Get override for an entity
   */
  getOverride(entityId: string): Partial<AgentCapabilitySet> | null {
    return this.overrides.get(entityId) || null;
  }

  /**
   * Set override for an entity
   */
  setOverride(entityId: string, override: Partial<AgentCapabilitySet>): void {
    this.overrides.set(entityId, override);
    this.dirty = true;
    this.autoSave();
  }

  /**
   * Remove capability chain for an entity
   */
  removeChain(entityId: string): boolean {
    const result = this.chains.delete(entityId);
    if (result) {
      this.dirty = true;
      this.autoSave();
    }
    return result;
  }

  /**
   * Remove override for an entity
   */
  removeOverride(entityId: string): boolean {
    const result = this.overrides.delete(entityId);
    if (result) {
      this.dirty = true;
      this.autoSave();
    }
    return result;
  }

  /**
   * List all stored entity IDs
   */
  listEntities(): string[] {
    const entities = new Set<string>();
    for (const id of this.chains.keys()) {
      entities.add(id);
    }
    for (const id of this.overrides.keys()) {
      entities.add(id);
    }
    return Array.from(entities);
  }

  /**
   * Clear all stored capabilities
   */
  clear(): void {
    this.chains.clear();
    this.overrides.clear();
    this.dirty = true;
    this.autoSave();
  }
}

/**
 * Convert shared config to capability set partial
 */
export function configToCapabilities(config: CapabilitiesConfigShared): Partial<AgentCapabilitySet> {
  const result: Partial<AgentCapabilitySet> = {
    enabled: config.enabled ?? true,
  };

  // Orchestration from preset or individual settings
  if (config.orchestrationLevel) {
    result.orchestration = { ...ORCHESTRATION_DEFAULTS[config.orchestrationLevel] };
  } else if (config.maxConcurrentSubagents !== undefined || config.maxSubagentDepth !== undefined) {
    result.orchestration = {
      ...ORCHESTRATION_DEFAULTS.standard,
      maxConcurrentSubagents: config.maxConcurrentSubagents ?? ORCHESTRATION_DEFAULTS.standard.maxConcurrentSubagents,
      maxSubagentDepth: config.maxSubagentDepth ?? ORCHESTRATION_DEFAULTS.standard.maxSubagentDepth,
    };
  }

  // Tool access policy
  if (config.toolPolicy) {
    const policy: ToolAccessPolicy = config.toolPolicy;
    result.tools = {
      policy,
      capabilities: [],
    };

    if (config.allowedTools?.length && policy === 'allow_list') {
      result.tools.capabilities = config.allowedTools.map((pattern) => ({
        pattern,
        allowed: true,
      }));
    }

    if (config.deniedTools?.length && policy === 'deny_list') {
      result.tools.capabilities = config.deniedTools.map((pattern) => ({
        pattern,
        allowed: false,
      }));
    }
  }

  return result;
}

/**
 * Get default capabilities for a scope
 */
export function getDefaultCapabilities(scope: CapabilityScope): Partial<AgentCapabilitySet> {
  switch (scope) {
    case 'system':
      return {}; // System defaults are the base
    case 'organization':
      return {}; // No org-level defaults yet
    case 'identity':
      return {}; // No identity-level defaults yet
    case 'assistant':
      return DEFAULT_CAPABILITY_SET;
    case 'session':
      return {}; // Sessions inherit from assistant
    case 'agent':
      return {}; // Agents inherit from session
    default:
      return {};
  }
}

/**
 * Get capability preset by name
 */
export function getCapabilityPreset(preset: 'default' | 'restricted' | 'coordinator'): Partial<AgentCapabilitySet> {
  switch (preset) {
    case 'restricted':
      return RESTRICTED_CAPABILITY_SET;
    case 'coordinator':
      return COORDINATOR_CAPABILITY_SET;
    case 'default':
    default:
      return DEFAULT_CAPABILITY_SET;
  }
}

// Singleton storage instance
let globalStorage: CapabilityStorage | null = null;

/**
 * Get or create the global capability storage
 */
export function getGlobalCapabilityStorage(config?: Partial<CapabilityStorageConfig>): CapabilityStorage {
  if (!globalStorage) {
    globalStorage = new CapabilityStorage(config);
  }
  return globalStorage;
}

/**
 * Reset the global capability storage (for testing)
 */
export function resetGlobalCapabilityStorage(): void {
  if (globalStorage) {
    globalStorage.clear();
    globalStorage = null;
  }
}

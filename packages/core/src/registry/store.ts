/**
 * Assistant Registry Store
 *
 * Provides storage layer for registered assistants with support for
 * in-memory and file-based persistence.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type {
  RegisteredAssistant,
  AssistantRegistration,
  AssistantUpdate,
  AssistantQuery,
  AssistantQueryResult,
  RegistryConfig,
  RegistryStats,
  AssistantType,
  RegistryAssistantState,
} from './types';
import { DEFAULT_REGISTRY_CONFIG } from './types';

/**
 * Generate a unique assistant ID
 */
function generateAssistantId(): string {
  return `assistant_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new assistant record from registration
 */
function createAssistantRecord(registration: AssistantRegistration): RegisteredAssistant {
  const now = new Date().toISOString();
  const id = registration.id || generateAssistantId();

  return {
    id,
    name: registration.name,
    description: registration.description,
    type: registration.type,
    sessionId: registration.sessionId,
    parentId: registration.parentId,
    childIds: [],
    capabilities: {
      tools: registration.capabilities.tools || [],
      skills: registration.capabilities.skills || [],
      models: registration.capabilities.models || [],
      tags: registration.capabilities.tags || [],
      maxConcurrent: registration.capabilities.maxConcurrent,
      maxDepth: registration.capabilities.maxDepth,
      toolScopes: registration.capabilities.toolScopes,
    },
    status: {
      state: 'idle',
      uptime: 0,
      messagesProcessed: 0,
      toolCallsExecuted: 0,
      errorsCount: 0,
    },
    load: {
      activeTasks: 0,
      queuedTasks: 0,
      tokensUsed: 0,
      llmCalls: 0,
      currentDepth: 0,
    },
    heartbeat: {
      lastHeartbeat: now,
      intervalMs: 10000,
      isStale: false,
      missedCount: 0,
    },
    registeredAt: now,
    updatedAt: now,
    endpoint: registration.endpoint,
    metadata: registration.metadata,
  };
}

/**
 * Check if assistant has required capabilities
 */
function hasRequiredCapabilities(
  assistant: RegisteredAssistant,
  required?: { tools?: string[]; skills?: string[]; tags?: string[] }
): boolean {
  if (!required) return true;

  if (required.tools?.length) {
    const hasAllTools = required.tools.every((tool) =>
      assistant.capabilities.tools.some((t) => t === tool || t.startsWith(tool.replace('*', '')))
    );
    if (!hasAllTools) return false;
  }

  if (required.skills?.length) {
    const hasAllSkills = required.skills.every((skill) =>
      assistant.capabilities.skills.includes(skill)
    );
    if (!hasAllSkills) return false;
  }

  if (required.tags?.length) {
    const hasAllTags = required.tags.every((tag) =>
      assistant.capabilities.tags.includes(tag)
    );
    if (!hasAllTags) return false;
  }

  return true;
}

/**
 * Calculate capability match score
 */
function calculateMatchScore(
  assistant: RegisteredAssistant,
  preferred?: { tools?: string[]; skills?: string[]; tags?: string[] }
): number {
  if (!preferred) return 1;

  let score = 0;
  let total = 0;

  if (preferred.tools?.length) {
    total += preferred.tools.length;
    score += preferred.tools.filter((tool) =>
      assistant.capabilities.tools.some((t) => t === tool || t.startsWith(tool.replace('*', '')))
    ).length;
  }

  if (preferred.skills?.length) {
    total += preferred.skills.length;
    score += preferred.skills.filter((skill) =>
      assistant.capabilities.skills.includes(skill)
    ).length;
  }

  if (preferred.tags?.length) {
    total += preferred.tags.length;
    score += preferred.tags.filter((tag) =>
      assistant.capabilities.tags.includes(tag)
    ).length;
  }

  return total > 0 ? score / total : 1;
}

/**
 * Check if assistant has excluded capabilities
 */
function hasExcludedCapabilities(
  assistant: RegisteredAssistant,
  excluded?: { tools?: string[]; skills?: string[]; tags?: string[] }
): boolean {
  if (!excluded) return false;

  if (excluded.tools?.length) {
    const hasExcludedTool = excluded.tools.some((tool) =>
      assistant.capabilities.tools.some((t) => t === tool || t.startsWith(tool.replace('*', '')))
    );
    if (hasExcludedTool) return true;
  }

  if (excluded.skills?.length) {
    const hasExcludedSkill = excluded.skills.some((skill) =>
      assistant.capabilities.skills.includes(skill)
    );
    if (hasExcludedSkill) return true;
  }

  if (excluded.tags?.length) {
    const hasExcludedTag = excluded.tags.some((tag) =>
      assistant.capabilities.tags.includes(tag)
    );
    if (hasExcludedTag) return true;
  }

  return false;
}

/**
 * Calculate load factor (0-1)
 */
function calculateLoadFactor(assistant: RegisteredAssistant): number {
  const { load, capabilities } = assistant;
  const maxConcurrent = capabilities.maxConcurrent || 5;

  // Weight active tasks heavily, queued tasks less
  const taskLoad = (load.activeTasks + load.queuedTasks * 0.5) / maxConcurrent;

  // Consider token usage if limit is set
  const tokenLoad = load.tokenLimit
    ? load.tokensUsed / load.tokenLimit
    : 0;

  // Combine factors
  return Math.min(1, Math.max(taskLoad, tokenLoad));
}

/**
 * Assistant Registry Store
 */
export class RegistryStore {
  private assistants: Map<string, RegisteredAssistant> = new Map();
  private config: RegistryConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt: number;

  constructor(config?: Partial<RegistryConfig>) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    this.startedAt = Date.now();

    // Load from storage if file mode
    if (this.config.storage === 'file') {
      this.loadFromFile();
    }

    // Start cleanup timer
    if (this.config.autoDeregister) {
      this.startCleanup();
    }
  }

  /**
   * Get storage file path
   */
  private getStoragePath(): string {
    if (this.config.storagePath) {
      return this.config.storagePath;
    }
    const home = process.env.HOME || process.env.USERPROFILE || homedir();
    return join(home, '.assistants', 'registry', 'assistants.json');
  }

  /**
   * Load assistants from file
   */
  private loadFromFile(): void {
    try {
      const path = this.getStoragePath();
      if (!existsSync(path)) return;

      const data = JSON.parse(readFileSync(path, 'utf-8'));
      if (Array.isArray(data.assistants)) {
        for (const assistant of data.assistants) {
          this.assistants.set(assistant.id, assistant);
        }
      }
    } catch {
      // Failed to load, start fresh
    }
  }

  /**
   * Save assistants to file
   */
  private saveToFile(): void {
    if (this.config.storage !== 'file') return;

    try {
      const path = this.getStoragePath();
      const dir = dirname(path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        assistants: Array.from(this.assistants.values()),
      };

      writeFileSync(path, JSON.stringify(data, null, 2));
    } catch {
      // Failed to save, non-critical
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanup(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleAssistants();
    }, this.config.cleanupInterval);
  }

  /**
   * Stop cleanup timer
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clean up stale assistants
   * This is called automatically on an interval, but can be called manually
   * to trigger cleanup (e.g., on startup to clean up crashed sessions)
   */
  cleanupStaleAssistants(): void {
    const now = Date.now();
    const staleThreshold = this.config.staleTTL;

    for (const [id, assistant] of this.assistants) {
      const lastHeartbeat = new Date(assistant.heartbeat.lastHeartbeat).getTime();
      const age = now - lastHeartbeat;

      if (age > staleThreshold) {
        // Auto-deregister stale assistants
        this.assistants.delete(id);
      } else if (age > this.config.heartbeatStaleThreshold) {
        // Mark as stale but keep
        assistant.heartbeat.isStale = true;
        assistant.heartbeat.missedCount = Math.floor(age / this.config.heartbeatStaleThreshold);
        assistant.status.state = 'offline';
        assistant.updatedAt = new Date().toISOString();
      }
    }

    this.saveToFile();
  }

  /**
   * Register a new assistant
   */
  register(registration: AssistantRegistration): RegisteredAssistant {
    // Check max assistants limit
    if (this.assistants.size >= this.config.maxAssistants) {
      // Try to clean up stale assistants first
      this.cleanupStaleAssistants();

      if (this.assistants.size >= this.config.maxAssistants) {
        throw new Error(`Registry full: maximum ${this.config.maxAssistants} assistants reached`);
      }
    }

    const assistant = createAssistantRecord(registration);

    // Update parent's childIds if parent exists
    if (assistant.parentId) {
      const parent = this.assistants.get(assistant.parentId);
      if (parent) {
        parent.childIds.push(assistant.id);
        parent.updatedAt = new Date().toISOString();
      }
    }

    this.assistants.set(assistant.id, assistant);
    this.saveToFile();

    return assistant;
  }

  /**
   * Get an assistant by ID
   */
  get(id: string): RegisteredAssistant | null {
    return this.assistants.get(id) || null;
  }

  /**
   * Update an assistant
   */
  update(id: string, update: AssistantUpdate): RegisteredAssistant | null {
    const assistant = this.assistants.get(id);
    if (!assistant) return null;

    const now = new Date().toISOString();

    if (update.name !== undefined) assistant.name = update.name;
    if (update.description !== undefined) assistant.description = update.description;

    if (update.capabilities) {
      assistant.capabilities = {
        ...assistant.capabilities,
        ...update.capabilities,
      };
    }

    if (update.status) {
      assistant.status = {
        ...assistant.status,
        ...update.status,
      };
    }

    if (update.load) {
      assistant.load = {
        ...assistant.load,
        ...update.load,
      };
    }

    if (update.metadata) {
      assistant.metadata = {
        ...assistant.metadata,
        ...update.metadata,
      };
    }

    assistant.updatedAt = now;
    this.saveToFile();

    return assistant;
  }

  /**
   * Record a heartbeat
   */
  heartbeat(id: string): RegisteredAssistant | null {
    const assistant = this.assistants.get(id);
    if (!assistant) return null;

    const now = new Date().toISOString();
    assistant.heartbeat.lastHeartbeat = now;
    assistant.heartbeat.isStale = false;
    assistant.heartbeat.missedCount = 0;

    // Recover from offline state
    if (assistant.status.state === 'offline') {
      assistant.status.state = 'idle';
    }

    assistant.updatedAt = now;

    return assistant;
  }

  /**
   * Deregister an assistant
   */
  deregister(id: string): boolean {
    const assistant = this.assistants.get(id);
    if (!assistant) return false;

    // Update parent's childIds
    if (assistant.parentId) {
      const parent = this.assistants.get(assistant.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter((cid) => cid !== id);
        parent.updatedAt = new Date().toISOString();
      }
    }

    // Deregister children
    for (const childId of assistant.childIds) {
      this.deregister(childId);
    }

    this.assistants.delete(id);
    this.saveToFile();

    return true;
  }

  /**
   * Query assistants
   */
  query(query: AssistantQuery): AssistantQueryResult {
    let results = Array.from(this.assistants.values());
    const scores = new Map<string, number>();

    // Filter by type
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      results = results.filter((a) => types.includes(a.type));
    }

    // Filter by state
    if (query.state) {
      const states = Array.isArray(query.state) ? query.state : [query.state];
      results = results.filter((a) => states.includes(a.status.state));
    }

    // Filter by session ID
    if (query.sessionId) {
      results = results.filter((a) => a.sessionId === query.sessionId);
    }

    // Filter by parent ID
    if (query.parentId) {
      results = results.filter((a) => a.parentId === query.parentId);
    }

    // Filter by required capabilities
    if (query.requiredCapabilities) {
      results = results.filter((a) => hasRequiredCapabilities(a, query.requiredCapabilities));
    }

    // Filter by excluded capabilities
    if (query.excludedCapabilities) {
      results = results.filter((a) => !hasExcludedCapabilities(a, query.excludedCapabilities));
    }

    // Exclude offline assistants if not requested
    if (!query.includeOffline) {
      results = results.filter((a) => a.status.state !== 'offline' && !a.heartbeat.isStale);
    }

    // Filter by max load factor
    if (query.maxLoadFactor !== undefined) {
      results = results.filter((a) => calculateLoadFactor(a) <= query.maxLoadFactor!);
    }

    // Calculate scores
    for (const assistant of results) {
      scores.set(assistant.id, calculateMatchScore(assistant, query.preferredCapabilities));
    }

    // Sort results
    const sortBy = query.sortBy || 'registeredAt';
    const sortDir = query.sortDir === 'desc' ? -1 : 1;

    results.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name) * sortDir;
        case 'load':
          return (calculateLoadFactor(a) - calculateLoadFactor(b)) * sortDir;
        case 'uptime':
          return (a.status.uptime - b.status.uptime) * sortDir;
        case 'registeredAt':
        default:
          return (new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime()) * sortDir;
      }
    });

    // Also sort by score (higher first) as secondary sort
    results.sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));

    const total = results.length;

    // Apply limit
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return { assistants: results, total, scores };
  }

  /**
   * List all assistants
   */
  list(): RegisteredAssistant[] {
    return Array.from(this.assistants.values());
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    const assistants = Array.from(this.assistants.values());

    const byType: Record<AssistantType, number> = {
      assistant: 0,
      subassistant: 0,
      coordinator: 0,
      worker: 0,
    };

    const byState: Record<RegistryAssistantState, number> = {
      idle: 0,
      processing: 0,
      waiting_input: 0,
      error: 0,
      offline: 0,
      stopped: 0,
    };

    let totalLoad = 0;
    let staleCount = 0;

    for (const assistant of assistants) {
      byType[assistant.type]++;
      byState[assistant.status.state]++;
      totalLoad += calculateLoadFactor(assistant);

      if (assistant.heartbeat.isStale) {
        staleCount++;
      }
    }

    return {
      totalAssistants: assistants.length,
      byType,
      byState,
      staleCount,
      averageLoad: assistants.length > 0 ? totalLoad / assistants.length : 0,
      uptime: (Date.now() - this.startedAt) / 1000,
    };
  }

  /**
   * Clear all assistants
   */
  clear(): void {
    this.assistants.clear();
    this.saveToFile();
  }
}

/**
 * Agent Registry Store
 *
 * Provides storage layer for registered agents with support for
 * in-memory and file-based persistence.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type {
  RegisteredAgent,
  AgentRegistration,
  AgentUpdate,
  AgentQuery,
  AgentQueryResult,
  RegistryConfig,
  RegistryStats,
  AgentType,
  RegistryAgentState,
} from './types';
import { DEFAULT_REGISTRY_CONFIG } from './types';

/**
 * Generate a unique agent ID
 */
function generateAgentId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new agent record from registration
 */
function createAgentRecord(registration: AgentRegistration): RegisteredAgent {
  const now = new Date().toISOString();
  const id = registration.id || generateAgentId();

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
 * Check if agent has required capabilities
 */
function hasRequiredCapabilities(
  agent: RegisteredAgent,
  required?: { tools?: string[]; skills?: string[]; tags?: string[] }
): boolean {
  if (!required) return true;

  if (required.tools?.length) {
    const hasAllTools = required.tools.every((tool) =>
      agent.capabilities.tools.some((t) => t === tool || t.startsWith(tool.replace('*', '')))
    );
    if (!hasAllTools) return false;
  }

  if (required.skills?.length) {
    const hasAllSkills = required.skills.every((skill) =>
      agent.capabilities.skills.includes(skill)
    );
    if (!hasAllSkills) return false;
  }

  if (required.tags?.length) {
    const hasAllTags = required.tags.every((tag) =>
      agent.capabilities.tags.includes(tag)
    );
    if (!hasAllTags) return false;
  }

  return true;
}

/**
 * Calculate capability match score
 */
function calculateMatchScore(
  agent: RegisteredAgent,
  preferred?: { tools?: string[]; skills?: string[]; tags?: string[] }
): number {
  if (!preferred) return 1;

  let score = 0;
  let total = 0;

  if (preferred.tools?.length) {
    total += preferred.tools.length;
    score += preferred.tools.filter((tool) =>
      agent.capabilities.tools.some((t) => t === tool || t.startsWith(tool.replace('*', '')))
    ).length;
  }

  if (preferred.skills?.length) {
    total += preferred.skills.length;
    score += preferred.skills.filter((skill) =>
      agent.capabilities.skills.includes(skill)
    ).length;
  }

  if (preferred.tags?.length) {
    total += preferred.tags.length;
    score += preferred.tags.filter((tag) =>
      agent.capabilities.tags.includes(tag)
    ).length;
  }

  return total > 0 ? score / total : 1;
}

/**
 * Check if agent has excluded capabilities
 */
function hasExcludedCapabilities(
  agent: RegisteredAgent,
  excluded?: { tools?: string[]; skills?: string[]; tags?: string[] }
): boolean {
  if (!excluded) return false;

  if (excluded.tools?.length) {
    const hasExcludedTool = excluded.tools.some((tool) =>
      agent.capabilities.tools.some((t) => t === tool || t.startsWith(tool.replace('*', '')))
    );
    if (hasExcludedTool) return true;
  }

  if (excluded.skills?.length) {
    const hasExcludedSkill = excluded.skills.some((skill) =>
      agent.capabilities.skills.includes(skill)
    );
    if (hasExcludedSkill) return true;
  }

  if (excluded.tags?.length) {
    const hasExcludedTag = excluded.tags.some((tag) =>
      agent.capabilities.tags.includes(tag)
    );
    if (hasExcludedTag) return true;
  }

  return false;
}

/**
 * Calculate load factor (0-1)
 */
function calculateLoadFactor(agent: RegisteredAgent): number {
  const { load, capabilities } = agent;
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
 * Agent Registry Store
 */
export class RegistryStore {
  private agents: Map<string, RegisteredAgent> = new Map();
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
    return join(home, '.assistants', 'registry', 'agents.json');
  }

  /**
   * Load agents from file
   */
  private loadFromFile(): void {
    try {
      const path = this.getStoragePath();
      if (!existsSync(path)) return;

      const data = JSON.parse(readFileSync(path, 'utf-8'));
      if (Array.isArray(data.agents)) {
        for (const agent of data.agents) {
          this.agents.set(agent.id, agent);
        }
      }
    } catch {
      // Failed to load, start fresh
    }
  }

  /**
   * Save agents to file
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
        agents: Array.from(this.agents.values()),
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
      this.cleanupStaleAgents();
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
   * Clean up stale agents
   * This is called automatically on an interval, but can be called manually
   * to trigger cleanup (e.g., on startup to clean up crashed sessions)
   */
  cleanupStaleAgents(): void {
    const now = Date.now();
    const staleThreshold = this.config.staleTTL;

    for (const [id, agent] of this.agents) {
      const lastHeartbeat = new Date(agent.heartbeat.lastHeartbeat).getTime();
      const age = now - lastHeartbeat;

      if (age > staleThreshold) {
        // Auto-deregister stale agents
        this.agents.delete(id);
      } else if (age > this.config.heartbeatStaleThreshold) {
        // Mark as stale but keep
        agent.heartbeat.isStale = true;
        agent.heartbeat.missedCount = Math.floor(age / this.config.heartbeatStaleThreshold);
        agent.status.state = 'offline';
        agent.updatedAt = new Date().toISOString();
      }
    }

    this.saveToFile();
  }

  /**
   * Register a new agent
   */
  register(registration: AgentRegistration): RegisteredAgent {
    // Check max agents limit
    if (this.agents.size >= this.config.maxAgents) {
      // Try to clean up stale agents first
      this.cleanupStaleAgents();

      if (this.agents.size >= this.config.maxAgents) {
        throw new Error(`Registry full: maximum ${this.config.maxAgents} agents reached`);
      }
    }

    const agent = createAgentRecord(registration);

    // Update parent's childIds if parent exists
    if (agent.parentId) {
      const parent = this.agents.get(agent.parentId);
      if (parent) {
        parent.childIds.push(agent.id);
        parent.updatedAt = new Date().toISOString();
      }
    }

    this.agents.set(agent.id, agent);
    this.saveToFile();

    return agent;
  }

  /**
   * Get an agent by ID
   */
  get(id: string): RegisteredAgent | null {
    return this.agents.get(id) || null;
  }

  /**
   * Update an agent
   */
  update(id: string, update: AgentUpdate): RegisteredAgent | null {
    const agent = this.agents.get(id);
    if (!agent) return null;

    const now = new Date().toISOString();

    if (update.name !== undefined) agent.name = update.name;
    if (update.description !== undefined) agent.description = update.description;

    if (update.capabilities) {
      agent.capabilities = {
        ...agent.capabilities,
        ...update.capabilities,
      };
    }

    if (update.status) {
      agent.status = {
        ...agent.status,
        ...update.status,
      };
    }

    if (update.load) {
      agent.load = {
        ...agent.load,
        ...update.load,
      };
    }

    if (update.metadata) {
      agent.metadata = {
        ...agent.metadata,
        ...update.metadata,
      };
    }

    agent.updatedAt = now;
    this.saveToFile();

    return agent;
  }

  /**
   * Record a heartbeat
   */
  heartbeat(id: string): RegisteredAgent | null {
    const agent = this.agents.get(id);
    if (!agent) return null;

    const now = new Date().toISOString();
    agent.heartbeat.lastHeartbeat = now;
    agent.heartbeat.isStale = false;
    agent.heartbeat.missedCount = 0;

    // Recover from offline state
    if (agent.status.state === 'offline') {
      agent.status.state = 'idle';
    }

    agent.updatedAt = now;

    return agent;
  }

  /**
   * Deregister an agent
   */
  deregister(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;

    // Update parent's childIds
    if (agent.parentId) {
      const parent = this.agents.get(agent.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter((cid) => cid !== id);
        parent.updatedAt = new Date().toISOString();
      }
    }

    // Deregister children
    for (const childId of agent.childIds) {
      this.deregister(childId);
    }

    this.agents.delete(id);
    this.saveToFile();

    return true;
  }

  /**
   * Query agents
   */
  query(query: AgentQuery): AgentQueryResult {
    let results = Array.from(this.agents.values());
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

    // Exclude offline agents if not requested
    if (!query.includeOffline) {
      results = results.filter((a) => a.status.state !== 'offline' && !a.heartbeat.isStale);
    }

    // Filter by max load factor
    if (query.maxLoadFactor !== undefined) {
      results = results.filter((a) => calculateLoadFactor(a) <= query.maxLoadFactor!);
    }

    // Calculate scores
    for (const agent of results) {
      scores.set(agent.id, calculateMatchScore(agent, query.preferredCapabilities));
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

    return { agents: results, total, scores };
  }

  /**
   * List all agents
   */
  list(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    const agents = Array.from(this.agents.values());

    const byType: Record<AgentType, number> = {
      assistant: 0,
      subagent: 0,
      coordinator: 0,
      worker: 0,
    };

    const byState: Record<RegistryAgentState, number> = {
      idle: 0,
      processing: 0,
      waiting_input: 0,
      error: 0,
      offline: 0,
      stopped: 0,
    };

    let totalLoad = 0;
    let staleCount = 0;

    for (const agent of agents) {
      byType[agent.type]++;
      byState[agent.status.state]++;
      totalLoad += calculateLoadFactor(agent);

      if (agent.heartbeat.isStale) {
        staleCount++;
      }
    }

    return {
      totalAgents: agents.length,
      byType,
      byState,
      staleCount,
      averageLoad: agents.length > 0 ? totalLoad / agents.length : 0,
      uptime: (Date.now() - this.startedAt) / 1000,
    };
  }

  /**
   * Clear all agents
   */
  clear(): void {
    this.agents.clear();
    this.saveToFile();
  }
}

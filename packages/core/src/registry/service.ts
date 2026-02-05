/**
 * Agent Registry Service
 *
 * Provides high-level API for agent registration, discovery, and lifecycle management.
 * Integrates with heartbeat system for automatic registration and health tracking.
 */

import type {
  RegisteredAgent,
  AgentRegistration,
  AgentUpdate,
  AgentQuery,
  AgentQueryResult,
  RegistryConfig,
  RegistryStats,
  RegistryEvent,
  RegistryEventListener,
  RegistryEventType,
  AgentCapabilities,
} from './types';
import { DEFAULT_REGISTRY_CONFIG } from './types';
import { RegistryStore } from './store';

/**
 * Agent Registry Service
 */
export class AgentRegistryService {
  private store: RegistryStore;
  private config: RegistryConfig;
  private listeners: Set<RegistryEventListener> = new Set();

  constructor(config?: Partial<RegistryConfig>) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    this.store = new RegistryStore(this.config);
  }

  /**
   * Emit a registry event
   */
  private emit(
    type: RegistryEventType,
    agentId: string,
    agent?: RegisteredAgent,
    previousState?: Partial<RegisteredAgent>
  ): void {
    const event: RegistryEvent = {
      type,
      agentId,
      agent,
      previousState,
      timestamp: new Date().toISOString(),
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Add event listener
   */
  addEventListener(listener: RegistryEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: RegistryEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Check if registry is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Register a new agent
   */
  register(registration: AgentRegistration): RegisteredAgent {
    if (!this.config.enabled) {
      throw new Error('Registry is disabled');
    }

    const agent = this.store.register(registration);
    this.emit('agent:registered', agent.id, agent);

    return agent;
  }

  /**
   * Register from heartbeat data
   * Used for auto-registration when agents start
   */
  registerFromHeartbeat(data: {
    agentId: string;
    name: string;
    sessionId?: string;
    parentId?: string;
    tools?: string[];
    skills?: string[];
  }): RegisteredAgent {
    if (!this.config.autoRegister) {
      throw new Error('Auto-registration is disabled');
    }

    // Check if already registered
    const existing = this.store.get(data.agentId);
    if (existing) {
      // Just update heartbeat
      return this.heartbeat(data.agentId) || existing;
    }

    return this.register({
      id: data.agentId,
      name: data.name,
      type: data.parentId ? 'subagent' : 'assistant',
      sessionId: data.sessionId,
      parentId: data.parentId,
      capabilities: {
        tools: data.tools,
        skills: data.skills,
      },
    });
  }

  /**
   * Get an agent by ID
   */
  get(id: string): RegisteredAgent | null {
    return this.store.get(id);
  }

  /**
   * Update an agent
   */
  update(id: string, update: AgentUpdate): RegisteredAgent | null {
    const previous = this.store.get(id);
    const agent = this.store.update(id, update);

    if (agent) {
      this.emit('agent:updated', id, agent, previous || undefined);
    }

    return agent;
  }

  /**
   * Update agent status
   */
  updateStatus(
    id: string,
    status: Partial<RegisteredAgent['status']>
  ): RegisteredAgent | null {
    return this.update(id, { status });
  }

  /**
   * Update agent load
   */
  updateLoad(
    id: string,
    load: Partial<RegisteredAgent['load']>
  ): RegisteredAgent | null {
    return this.update(id, { load });
  }

  /**
   * Update agent capabilities
   */
  updateCapabilities(
    id: string,
    capabilities: Partial<AgentCapabilities>
  ): RegisteredAgent | null {
    return this.update(id, { capabilities });
  }

  /**
   * Record a heartbeat for an agent
   */
  heartbeat(id: string): RegisteredAgent | null {
    const previous = this.store.get(id);
    const wasStale = previous?.heartbeat.isStale;

    const agent = this.store.heartbeat(id);

    if (agent && wasStale) {
      this.emit('agent:recovered', id, agent);
    }

    return agent;
  }

  /**
   * Deregister an agent
   */
  deregister(id: string): boolean {
    const agent = this.store.get(id);
    const result = this.store.deregister(id);

    if (result && agent) {
      this.emit('agent:deregistered', id, undefined, agent);
    }

    return result;
  }

  /**
   * Query agents by criteria
   */
  query(query: AgentQuery): AgentQueryResult {
    return this.store.query(query);
  }

  /**
   * Find agents by capability
   */
  findByCapability(capability: {
    tools?: string[];
    skills?: string[];
    tags?: string[];
  }): RegisteredAgent[] {
    const result = this.store.query({
      requiredCapabilities: capability,
      includeOffline: false,
    });
    return result.agents;
  }

  /**
   * Find available agents (idle, low load)
   */
  findAvailable(options?: {
    type?: RegisteredAgent['type'];
    maxLoadFactor?: number;
    limit?: number;
  }): RegisteredAgent[] {
    const result = this.store.query({
      type: options?.type,
      state: 'idle',
      maxLoadFactor: options?.maxLoadFactor ?? 0.8,
      limit: options?.limit,
      sortBy: 'load',
      sortDir: 'asc',
      includeOffline: false,
    });
    return result.agents;
  }

  /**
   * Find best agent for a task
   * Considers capabilities, load, and preferences
   */
  findBestMatch(requirements: {
    required?: { tools?: string[]; skills?: string[]; tags?: string[] };
    preferred?: { tools?: string[]; skills?: string[]; tags?: string[] };
    excluded?: { tools?: string[]; skills?: string[]; tags?: string[] };
    maxLoadFactor?: number;
  }): RegisteredAgent | null {
    const result = this.store.query({
      requiredCapabilities: requirements.required,
      preferredCapabilities: requirements.preferred,
      excludedCapabilities: requirements.excluded,
      maxLoadFactor: requirements.maxLoadFactor ?? 0.9,
      limit: 1,
      includeOffline: false,
    });

    return result.agents[0] || null;
  }

  /**
   * Get children of an agent
   */
  getChildren(parentId: string): RegisteredAgent[] {
    const result = this.store.query({
      parentId,
      includeOffline: true,
    });
    return result.agents;
  }

  /**
   * List all registered agents
   */
  list(): RegisteredAgent[] {
    return this.store.list();
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    return this.store.getStats();
  }

  /**
   * Stop the registry service
   */
  stop(): void {
    this.store.stopCleanup();
    this.listeners.clear();
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Manually trigger cleanup of stale agents
   * Useful on startup to clean up agents from crashed sessions
   */
  cleanupStaleAgents(): void {
    this.store.cleanupStaleAgents();
  }
}

// Singleton instance
let globalRegistry: AgentRegistryService | null = null;

/**
 * Get or create the global registry instance
 */
export function getGlobalRegistry(config?: Partial<RegistryConfig>): AgentRegistryService {
  if (!globalRegistry) {
    globalRegistry = new AgentRegistryService(config);
  }
  return globalRegistry;
}

/**
 * Reset the global registry (for testing)
 */
export function resetGlobalRegistry(): void {
  if (globalRegistry) {
    globalRegistry.stop();
    globalRegistry = null;
  }
}

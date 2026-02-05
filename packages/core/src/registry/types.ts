/**
 * Agent Registry Types
 *
 * Defines the data model for tracking registered agents in the system.
 * Supports both in-memory and persisted storage with TTL-based cleanup.
 */

import type { AgentState as HeartbeatAgentState } from '../heartbeat';

/**
 * Agent type classification
 */
export type AgentType = 'assistant' | 'subagent' | 'coordinator' | 'worker';

/**
 * Agent operational state (extends heartbeat state with 'offline')
 */
export type RegistryAgentState = HeartbeatAgentState | 'offline';

/**
 * Agent capabilities - what an agent can do
 */
export interface AgentCapabilities {
  /** Available tools this agent can use */
  tools: string[];
  /** Available skills this agent has access to */
  skills: string[];
  /** Supported LLM models */
  models: string[];
  /** Domain expertise tags (e.g., 'code', 'research', 'data') */
  tags: string[];
  /** Maximum concurrent tasks this agent can handle */
  maxConcurrent?: number;
  /** Maximum subagent depth this agent can spawn */
  maxDepth?: number;
  /** Tool scope restrictions (allowed patterns) */
  toolScopes?: string[];
}

/**
 * Agent current status
 */
export interface AgentStatus {
  /** Current operational state */
  state: RegistryAgentState;
  /** Current task being executed (if any) */
  currentTask?: string;
  /** Task description or summary */
  taskDescription?: string;
  /** Error message if in error state */
  errorMessage?: string;
  /** Uptime in seconds */
  uptime: number;
  /** Number of messages processed */
  messagesProcessed: number;
  /** Number of tool calls executed */
  toolCallsExecuted: number;
  /** Number of errors encountered */
  errorsCount: number;
}

/**
 * Agent resource usage and load
 */
export interface AgentLoad {
  /** Number of active/running tasks */
  activeTasks: number;
  /** Number of queued tasks waiting */
  queuedTasks: number;
  /** Total tokens used in current session */
  tokensUsed: number;
  /** Token budget limit (if set) */
  tokenLimit?: number;
  /** LLM calls made */
  llmCalls: number;
  /** LLM call limit (if set) */
  llmCallLimit?: number;
  /** Current recursion depth */
  currentDepth: number;
}

/**
 * Heartbeat information for liveness tracking
 */
export interface HeartbeatInfo {
  /** Last heartbeat timestamp (ISO string) */
  lastHeartbeat: string;
  /** Heartbeat interval in milliseconds */
  intervalMs: number;
  /** Whether heartbeat is considered stale */
  isStale: boolean;
  /** Consecutive missed heartbeats */
  missedCount: number;
}

/**
 * Registered agent record
 */
export interface RegisteredAgent {
  /** Unique agent identifier */
  id: string;
  /** Human-readable agent name */
  name: string;
  /** Optional description */
  description?: string;
  /** Agent type classification */
  type: AgentType;

  // Relationships
  /** Associated session ID */
  sessionId?: string;
  /** Parent agent ID (for subagents) */
  parentId?: string;
  /** Child agent IDs */
  childIds: string[];

  // Capabilities
  /** What this agent can do */
  capabilities: AgentCapabilities;

  // Status
  /** Current operational status */
  status: AgentStatus;
  /** Current resource load */
  load: AgentLoad;
  /** Heartbeat information */
  heartbeat: HeartbeatInfo;

  // Lifecycle timestamps
  /** When agent was registered */
  registeredAt: string;
  /** When agent was last updated */
  updatedAt: string;
  /** When agent was deregistered (if applicable) */
  deregisteredAt?: string;

  // Location (for remote agents)
  /** Endpoint URL for remote agents */
  endpoint?: string;
  /** Region/zone for distributed deployments */
  region?: string;

  // Metadata
  /** Additional custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Agent registration request
 */
export interface AgentRegistration {
  /** Optional specific ID (generated if not provided) */
  id?: string;
  /** Agent name */
  name: string;
  /** Optional description */
  description?: string;
  /** Agent type */
  type: AgentType;
  /** Session ID */
  sessionId?: string;
  /** Parent agent ID */
  parentId?: string;
  /** Initial capabilities */
  capabilities: Partial<AgentCapabilities>;
  /** Remote endpoint */
  endpoint?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Agent update request
 */
export interface AgentUpdate {
  /** Update name */
  name?: string;
  /** Update description */
  description?: string;
  /** Update capabilities */
  capabilities?: Partial<AgentCapabilities>;
  /** Update status */
  status?: Partial<AgentStatus>;
  /** Update load */
  load?: Partial<AgentLoad>;
  /** Update metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Query parameters for finding agents
 */
export interface AgentQuery {
  /** Filter by agent type */
  type?: AgentType | AgentType[];
  /** Filter by state */
  state?: RegistryAgentState | RegistryAgentState[];
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by parent ID */
  parentId?: string;
  /** Filter by required capabilities (all must match) */
  requiredCapabilities?: {
    tools?: string[];
    skills?: string[];
    tags?: string[];
  };
  /** Filter by preferred capabilities (any match improves score) */
  preferredCapabilities?: {
    tools?: string[];
    skills?: string[];
    tags?: string[];
  };
  /** Exclude agents with these capabilities */
  excludedCapabilities?: {
    tools?: string[];
    skills?: string[];
    tags?: string[];
  };
  /** Include offline/stale agents */
  includeOffline?: boolean;
  /** Maximum load threshold (0-1) */
  maxLoadFactor?: number;
  /** Maximum results to return */
  limit?: number;
  /** Sort field */
  sortBy?: 'name' | 'registeredAt' | 'load' | 'uptime';
  /** Sort direction */
  sortDir?: 'asc' | 'desc';
}

/**
 * Query result with scored matches
 */
export interface AgentQueryResult {
  /** Matching agents */
  agents: RegisteredAgent[];
  /** Total count (before limit) */
  total: number;
  /** Match scores (0-1) for each agent */
  scores: Map<string, number>;
}

/**
 * Registry configuration
 */
export interface RegistryConfig {
  /** Enable registry (default: true) */
  enabled: boolean;
  /** Storage mode */
  storage: 'memory' | 'file' | 'database';
  /** Storage path (for file mode) */
  storagePath?: string;
  /** Time-to-live for stale agents in milliseconds (default: 5 minutes) */
  staleTTL: number;
  /** Cleanup interval in milliseconds (default: 1 minute) */
  cleanupInterval: number;
  /** Maximum agents to track (default: 1000) */
  maxAgents: number;
  /** Auto-register from heartbeat (default: true) */
  autoRegister: boolean;
  /** Auto-deregister stale agents (default: true) */
  autoDeregister: boolean;
  /** Heartbeat stale threshold in milliseconds (default: 30 seconds) */
  heartbeatStaleThreshold: number;
}

/**
 * Default registry configuration
 */
export const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  enabled: true,
  storage: 'memory',
  staleTTL: 5 * 60 * 1000, // 5 minutes
  cleanupInterval: 60 * 1000, // 1 minute
  maxAgents: 1000,
  autoRegister: true,
  autoDeregister: true,
  heartbeatStaleThreshold: 30 * 1000, // 30 seconds
};

/**
 * Registry event types
 */
export type RegistryEventType =
  | 'agent:registered'
  | 'agent:updated'
  | 'agent:deregistered'
  | 'agent:stale'
  | 'agent:recovered'
  | 'agent:error';

/**
 * Registry event payload
 */
export interface RegistryEvent {
  type: RegistryEventType;
  agentId: string;
  agent?: RegisteredAgent;
  previousState?: Partial<RegisteredAgent>;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Registry event listener
 */
export type RegistryEventListener = (event: RegistryEvent) => void;

/**
 * Registry statistics
 */
export interface RegistryStats {
  /** Total registered agents */
  totalAgents: number;
  /** Agents by type */
  byType: Record<AgentType, number>;
  /** Agents by state */
  byState: Record<RegistryAgentState, number>;
  /** Stale agents count */
  staleCount: number;
  /** Average load factor */
  averageLoad: number;
  /** Registry uptime */
  uptime: number;
}

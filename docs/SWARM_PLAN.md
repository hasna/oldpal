# Swarm Foundations Plan

## Overview

This document outlines the phased implementation plan for swarm foundations: agent registry, capability model, and integration with budgets/guardrails.

## Current Infrastructure Audit

### What Exists

| Component | Location | Status |
|-----------|----------|--------|
| SubagentManager | `core/src/agent/subagent-manager.ts` | Complete - depth limiting, concurrent limits, tool filtering |
| Heartbeat | `core/src/heartbeat/` | Complete - state tracking, recovery, persistence |
| Tasks | `core/src/tasks/` | Complete - CRUD, recurring, project-local |
| Messages | `core/src/messages/` | Complete - agent-to-agent, threads, injection |
| Budget | `core/src/budget/` | Complete - session/agent/swarm scopes |
| Guardrails | `core/src/guardrails/` | Complete - policies, enforcement |
| Global Memory | `core/src/memory/` | Complete - categories, injection |

### What's Missing

| Component | Priority | Effort |
|-----------|----------|--------|
| Agent Registry | P0 | High |
| Capability Model | P0 | High |
| Swarm Coordinator | P0 | Very High |
| Swarm Dispatcher | P1 | High |
| Results Aggregation | P1 | Medium |
| Shared Swarm Memory | P1 | Medium |
| Decision Policies | P2 | Medium |
| RPC Communication | P2 | High |
| Swarm Recovery | P2 | Medium |
| Monitoring | P3 | Medium |

---

## Phase 1: Agent Registry & Data Model

### Deliverables
1. Agent registry data model/schema
2. Registry service with CRUD
3. Heartbeat integration for auto-registration
4. Query APIs for lookup

### Schema

```typescript
// packages/core/src/registry/types.ts

interface RegisteredAgent {
  id: string;
  name: string;
  description?: string;
  type: 'assistant' | 'subagent' | 'coordinator' | 'worker';

  // Capabilities
  capabilities: AgentCapabilities;

  // State
  status: AgentStatus;
  load: AgentLoad;

  // Lifecycle
  registeredAt: string;
  lastHeartbeat: string;
  sessionId?: string;
  parentId?: string;

  // Location
  endpoint?: string;  // For remote agents
  metadata?: Record<string, unknown>;
}

interface AgentCapabilities {
  tools: string[];           // Available tools
  skills: string[];          // Available skills
  models: string[];          // Supported models
  tags: string[];            // Domain expertise
  maxConcurrent?: number;    // Max concurrent tasks
  maxDepth?: number;         // Max subagent depth
}

interface AgentStatus {
  state: 'idle' | 'processing' | 'waiting' | 'error' | 'offline';
  currentTask?: string;
  errorMessage?: string;
  uptime: number;
}

interface AgentLoad {
  activeTasks: number;
  queuedTasks: number;
  tokensUsed: number;
  tokenLimit?: number;
}
```

### Files to Create
- `packages/core/src/registry/types.ts` - Type definitions
- `packages/core/src/registry/store.ts` - Storage layer
- `packages/core/src/registry/service.ts` - Registry service
- `packages/core/src/registry/index.ts` - Exports

### Implementation Steps
1. Define types and interfaces
2. Implement local storage (SQLite or JSON file)
3. Add auto-registration from heartbeat
4. Implement query methods (by capability, by status, by load)
5. Add lifecycle hooks (register, deregister, update)

---

## Phase 2: Capability Model & Matching

### Deliverables
1. Capability schema with inheritance
2. Capability matching algorithm
3. Tool-to-capability mapping
4. Capability enforcement in agent loop

### Schema

```typescript
// packages/core/src/capabilities/types.ts

interface Capability {
  id: string;
  name: string;
  description?: string;

  // Hierarchy
  parent?: string;           // Parent capability ID
  children?: string[];       // Child capability IDs

  // Requirements
  requiredTools?: string[];
  requiredSkills?: string[];
  requiredModels?: string[];

  // Metadata
  tags: string[];
  priority?: number;
}

interface CapabilityMatch {
  capability: string;
  agents: string[];          // Matching agent IDs
  confidence: number;        // 0-1 match quality
}

interface CapabilityRequest {
  required: string[];        // Must have
  preferred?: string[];      // Nice to have
  excluded?: string[];       // Must not have
}
```

### Matching Algorithm
1. Filter agents by required capabilities
2. Score by preferred capabilities
3. Exclude blacklisted capabilities
4. Rank by load/availability
5. Return sorted list of candidates

### Files to Create
- `packages/core/src/capabilities/types.ts`
- `packages/core/src/capabilities/schema.ts` - Built-in capabilities
- `packages/core/src/capabilities/matcher.ts` - Matching logic
- `packages/core/src/capabilities/index.ts`

---

## Phase 3: Swarm Coordinator

### Deliverables
1. Swarm coordinator mode in SubagentManager
2. Parallel agent spawning
3. Task graph construction
4. Dependency scheduling
5. Results aggregation

### Design

```typescript
// packages/core/src/swarm/types.ts

interface SwarmConfig {
  maxAgents: number;
  strategy: 'parallel' | 'pipeline' | 'fan-out-fan-in';
  aggregation: 'merge' | 'vote' | 'consensus' | 'first';
  timeout: number;
  retries: number;
}

interface SwarmTask {
  id: string;
  description: string;
  capability: CapabilityRequest;
  dependencies: string[];    // Task IDs
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed';
  assignedAgent?: string;
  result?: SwarmTaskResult;
}

interface SwarmTaskResult {
  success: boolean;
  output: string;
  artifacts?: string[];
  metrics: {
    duration: number;
    tokenUsage: number;
    toolCalls: number;
  };
}

interface SwarmExecution {
  id: string;
  config: SwarmConfig;
  tasks: SwarmTask[];
  state: 'planning' | 'executing' | 'aggregating' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  results?: AggregatedResult;
}
```

### Files to Create
- `packages/core/src/swarm/types.ts`
- `packages/core/src/swarm/coordinator.ts` - Main coordinator
- `packages/core/src/swarm/scheduler.ts` - Task scheduling
- `packages/core/src/swarm/aggregator.ts` - Result aggregation
- `packages/core/src/swarm/index.ts`

### Execution Flow
```
1. Coordinator receives task graph
2. Scheduler builds execution DAG
3. For each ready task:
   a. Query registry for capable agents
   b. Select best agent (load, capability match)
   c. Dispatch task via SubagentManager
   d. Track progress
4. On task completion:
   a. Update dependencies
   b. Schedule newly ready tasks
5. When all complete:
   a. Aggregate results
   b. Return to caller
```

---

## Phase 4: Tools & APIs

### New Tools

| Tool | Description |
|------|-------------|
| `registry_list` | List registered agents |
| `registry_query` | Query by capability |
| `registry_status` | Get agent status |
| `swarm_spawn` | Launch swarm execution |
| `swarm_status` | Check swarm progress |
| `swarm_cancel` | Cancel swarm execution |
| `capability_list` | List available capabilities |
| `capability_check` | Check agent capabilities |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/registry` | GET | List agents |
| `/api/v1/registry/query` | POST | Query by capability |
| `/api/v1/registry/:id` | GET | Get agent details |
| `/api/v1/swarm` | POST | Start swarm |
| `/api/v1/swarm/:id` | GET | Get swarm status |
| `/api/v1/swarm/:id` | DELETE | Cancel swarm |
| `/api/v1/capabilities` | GET | List capabilities |

---

## Phase 5: UI & Monitoring

### Terminal UI
- `/registry` command - Interactive registry panel
- `/swarm` command - Swarm status panel
- Status bar indicators for active swarms

### Web UI
- Registry dashboard with agent cards
- Swarm execution timeline
- Capability browser
- Real-time status updates

---

## Dependency Graph

```
Phase 1: Registry
    ├── Schema definition
    ├── Storage implementation
    ├── Service implementation
    └── Heartbeat integration

Phase 2: Capabilities (depends on Phase 1)
    ├── Capability schema
    ├── Matching algorithm
    └── Enforcement

Phase 3: Swarm (depends on Phase 1 & 2)
    ├── Coordinator
    ├── Scheduler
    ├── Dispatcher
    └── Aggregator

Phase 4: Tools/APIs (depends on Phase 1-3)
    ├── Registry tools
    ├── Swarm tools
    └── HTTP APIs

Phase 5: UI (depends on Phase 4)
    ├── Terminal panels
    └── Web dashboards
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Complexity explosion | High | Start with simple registry, iterate |
| Performance bottlenecks | Medium | Cache registry lookups, async dispatch |
| Deadlocks in task graph | High | Detect cycles, timeout handling |
| Agent failures | Medium | Retry with fallback agents |
| Resource exhaustion | High | Integrate with budget system |
| Security/isolation | High | Leverage guardrails policies |

---

## Integration Points

### With Budget System
- Swarm-level budget tracking (already exists)
- Per-agent budget allocation
- Coordinator respects budget limits

### With Guardrails
- Policy enforcement on agent selection
- Tool filtering per capability
- Approval workflows for swarm spawning

### With Memory System
- Shared swarm memory scope
- Result persistence
- Cross-agent context sharing

### With Heartbeat
- Auto-registration on start
- Auto-deregistration on stop
- Health checks for routing decisions

---

## Task Breakdown

### Phase 1 Tasks (Agent Registry)
1. Create registry types.ts with schema
2. Implement registry store with persistence
3. Implement registry service
4. Integrate with heartbeat for auto-registration
5. Add registry query APIs
6. Add registry tools (list, query, status)
7. Add registry tests

### Phase 2 Tasks (Capabilities)
1. Create capability types.ts
2. Define built-in capability schema
3. Implement capability matcher
4. Add capability enforcement in agent loop
5. Add capability tools
6. Add capability tests

### Phase 3 Tasks (Swarm)
1. Create swarm types.ts
2. Implement task graph construction
3. Implement dependency scheduler
4. Implement swarm coordinator
5. Implement result aggregator
6. Add swarm tools
7. Integrate with budget/guardrails
8. Add swarm tests

### Phase 4 Tasks (APIs)
1. Expose registry APIs
2. Expose swarm APIs
3. Document APIs

### Phase 5 Tasks (UI)
1. Create registry terminal panel
2. Create swarm status panel
3. Add web registry dashboard
4. Add web swarm monitoring

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1 | 3-5 days | None |
| Phase 2 | 2-3 days | Phase 1 |
| Phase 3 | 5-7 days | Phase 1, 2 |
| Phase 4 | 2-3 days | Phase 3 |
| Phase 5 | 3-4 days | Phase 4 |

**Total: 15-22 days**

---

## Conclusion

The swarm foundations require building on top of the existing solid infrastructure (heartbeat, messaging, budget, guardrails). The phased approach ensures each component is complete before moving to dependent components.

Key priorities:
1. **Registry first** - Everything else depends on knowing what agents exist
2. **Capabilities second** - Enables intelligent routing
3. **Coordinator third** - The actual swarm execution engine
4. **APIs/UI last** - Exposure layer built on stable foundations

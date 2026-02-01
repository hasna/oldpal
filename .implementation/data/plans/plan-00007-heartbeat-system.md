# Plan: Heartbeat & Agent State System

**Plan ID:** 00007
**Status:** Completed
**Priority:** Medium
**Estimated Effort:** Small (2 days)
**Dependencies:** None

---

## Overview

Implement a heartbeat system to track agent state and activity. This enables better monitoring, crash detection, and state persistence for long-running sessions.

## Current State

- No heartbeat or activity tracking
- Crash recovery not possible
- No way to detect stale sessions
- Agent state not persisted

## Requirements

### Functional
1. Regular heartbeat emission during activity
2. Track agent state (idle, processing, waiting)
3. Persist state for crash recovery
4. Detect and report stale sessions

### Non-Functional
1. Minimal resource overhead
2. Heartbeat interval configurable
3. State file should be small
4. Recovery should be seamless

## Technical Design

### Heartbeat System

```typescript
// packages/core/src/heartbeat/types.ts

type AgentState = 'idle' | 'processing' | 'waiting_input' | 'error' | 'stopped';

interface Heartbeat {
  sessionId: string;
  timestamp: string;
  state: AgentState;
  lastActivity: string;
  stats: HeartbeatStats;
}

interface HeartbeatStats {
  messagesProcessed: number;
  toolCallsExecuted: number;
  errorsEncountered: number;
  uptime: number;  // seconds
}

interface HeartbeatConfig {
  interval: number;       // ms between heartbeats
  staleThreshold: number; // ms before considered stale
  persistPath: string;    // where to save state
}
```

### Heartbeat Manager

```typescript
// packages/core/src/heartbeat/manager.ts

class HeartbeatManager {
  private config: HeartbeatConfig;
  private state: AgentState = 'idle';
  private startTime: number;
  private stats: HeartbeatStats;
  private intervalId?: NodeJS.Timeout;
  private listeners: Set<(heartbeat: Heartbeat) => void> = new Set();

  constructor(config: HeartbeatConfig) {
    this.config = config;
    this.startTime = Date.now();
    this.stats = {
      messagesProcessed: 0,
      toolCallsExecuted: 0,
      errorsEncountered: 0,
      uptime: 0,
    };
  }

  start(sessionId: string): void {
    this.intervalId = setInterval(() => {
      this.emit(sessionId);
    }, this.config.interval);

    // Initial heartbeat
    this.emit(sessionId);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  setState(state: AgentState): void {
    this.state = state;
  }

  recordActivity(type: 'message' | 'tool' | 'error'): void {
    switch (type) {
      case 'message':
        this.stats.messagesProcessed++;
        break;
      case 'tool':
        this.stats.toolCallsExecuted++;
        break;
      case 'error':
        this.stats.errorsEncountered++;
        break;
    }
  }

  onHeartbeat(listener: (heartbeat: Heartbeat) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(sessionId: string): void {
    const heartbeat: Heartbeat = {
      sessionId,
      timestamp: new Date().toISOString(),
      state: this.state,
      lastActivity: new Date().toISOString(),
      stats: {
        ...this.stats,
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
      },
    };

    // Notify listeners
    for (const listener of this.listeners) {
      listener(heartbeat);
    }

    // Persist
    this.persist(heartbeat);
  }

  private async persist(heartbeat: Heartbeat): Promise<void> {
    try {
      await writeFile(
        this.config.persistPath,
        JSON.stringify(heartbeat, null, 2)
      );
    } catch (error) {
      // Non-critical, log but don't throw
      console.warn('Failed to persist heartbeat:', error);
    }
  }

  static async checkStale(path: string, threshold: number): Promise<{
    isStale: boolean;
    lastHeartbeat?: Heartbeat;
  }> {
    try {
      const content = await readFile(path, 'utf-8');
      const heartbeat = JSON.parse(content) as Heartbeat;
      const age = Date.now() - new Date(heartbeat.timestamp).getTime();

      return {
        isStale: age > threshold,
        lastHeartbeat: heartbeat,
      };
    } catch {
      return { isStale: true };
    }
  }
}
```

### State Persistence

```typescript
// packages/core/src/heartbeat/persistence.ts

interface PersistedState {
  sessionId: string;
  heartbeat: Heartbeat;
  context: {
    cwd: string;
    lastCommand?: string;
    pendingToolCalls?: string[];
  };
  timestamp: string;
}

class StatePersistence {
  private path: string;

  constructor(configDir: string) {
    this.path = join(configDir, 'state.json');
  }

  async save(state: PersistedState): Promise<void> {
    await writeFile(this.path, JSON.stringify(state, null, 2));
  }

  async load(): Promise<PersistedState | null> {
    try {
      const content = await readFile(this.path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch {
      // File might not exist
    }
  }
}
```

### Recovery System

```typescript
// packages/core/src/heartbeat/recovery.ts

interface RecoveryOptions {
  autoResume: boolean;
  maxAge: number;  // Max age of state to recover (ms)
}

class RecoveryManager {
  private persistence: StatePersistence;
  private options: RecoveryOptions;

  async checkForRecovery(): Promise<{
    available: boolean;
    state?: PersistedState;
    reason?: string;
  }> {
    const state = await this.persistence.load();

    if (!state) {
      return { available: false, reason: 'No saved state' };
    }

    const age = Date.now() - new Date(state.timestamp).getTime();
    if (age > this.options.maxAge) {
      return { available: false, reason: 'State too old' };
    }

    // Check if session crashed (heartbeat stale but state exists)
    const heartbeatAge = Date.now() - new Date(state.heartbeat.timestamp).getTime();
    if (heartbeatAge < 60000) {
      return { available: false, reason: 'Session still active' };
    }

    return { available: true, state };
  }

  async recover(state: PersistedState): Promise<void> {
    // Restore session context
    process.chdir(state.context.cwd);

    // Notify user of recovery
    console.log(`Recovered session from ${state.timestamp}`);
    console.log(`Last state: ${state.heartbeat.state}`);
    console.log(`Stats: ${state.heartbeat.stats.messagesProcessed} messages, ${state.heartbeat.stats.toolCallsExecuted} tool calls`);

    // Clear the persisted state
    await this.persistence.clear();
  }
}
```

## Implementation Steps

### Step 1: Create Heartbeat Types
- [x] Define AgentState type
- [x] Define Heartbeat interface
- [x] Define HeartbeatConfig
- [x] Define HeartbeatStats

**Files:**
- `packages/core/src/heartbeat/types.ts`

### Step 2: Implement HeartbeatManager
- [x] Create HeartbeatManager class
- [x] Add interval management
- [x] Add state tracking
- [x] Add activity recording
- [x] Add listeners

**Files:**
- `packages/core/src/heartbeat/manager.ts`

### Step 3: Implement Persistence
- [x] Create StatePersistence class
- [x] Add save/load methods
- [x] Add recovery check

**Files:**
- `packages/core/src/heartbeat/persistence.ts`

### Step 4: Implement Recovery
- [x] Create RecoveryManager class
- [x] Detect crashed sessions
- [x] Implement recovery flow
- [x] Add user prompts

**Files:**
- `packages/core/src/heartbeat/recovery.ts`

### Step 5: Integrate with Agent
- [x] Add HeartbeatManager to AgentLoop
- [x] Update state on activity
- [x] Record stats
- [x] Check for recovery on start

**Files:**
- `packages/core/src/agent/loop.ts`
- `packages/core/src/client.ts`

### Step 6: Add Tests
- [x] Test heartbeat emission
- [x] Test state tracking
- [x] Test persistence
- [x] Test recovery

**Files:**
- `packages/core/tests/heartbeat.test.ts`

## Testing Strategy

```typescript
describe('HeartbeatManager', () => {
  it('should emit heartbeats at interval');
  it('should track state changes');
  it('should record activity stats');
  it('should persist heartbeat');
});

describe('RecoveryManager', () => {
  it('should detect crashed sessions');
  it('should recover state');
  it('should ignore old state');
  it('should not recover active sessions');
});
```

## Rollout Plan

1. Implement heartbeat types
2. Build HeartbeatManager
3. Add persistence
4. Implement recovery
5. Integrate with agent
6. Add tests

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| File I/O overhead | Low | Async writes, reasonable interval |
| Recovery of corrupt state | Medium | Validate state before recovery |
| Multiple instances conflict | Medium | Session ID in filename |

---

## Approval

- [x] Technical design approved
- [x] Implementation steps clear
- [x] Tests defined
- [x] Ready to implement

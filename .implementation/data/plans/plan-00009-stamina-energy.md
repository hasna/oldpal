# Plan: Stamina & Energy System

**Plan ID:** 00009
**Status:** Completed
**Priority:** Low
**Estimated Effort:** Medium (2-3 days)
**Dependencies:** plan-00007 (Heartbeat System)

---

## Overview

Implement a gamified stamina/energy system that tracks usage and adds fun personality to the assistant. Energy depletes with activity and regenerates over time or through "rest".

## Current State

- No usage tracking
- No gamification elements
- No personality/fun elements
- No usage limits or pacing

## Requirements

### Functional
1. Track energy consumption per action
2. Regenerate energy over time
3. Different energy costs for different actions
4. Visual energy indicator
5. Low energy effects (slower, shorter responses)

### Non-Functional
1. System should be optional/configurable
2. Should not block critical operations
3. Should add fun without being annoying
4. Stats should persist across sessions

## Technical Design

### Energy System

```typescript
// packages/core/src/energy/types.ts

interface EnergyState {
  current: number;        // 0-100
  max: number;            // Default 100
  regenRate: number;      // Per minute
  lastUpdate: string;     // ISO timestamp
}

interface EnergyCosts {
  message: number;        // Per user message processed
  toolCall: number;       // Per tool execution
  llmCall: number;        // Per LLM API call
  longContext: number;    // Bonus cost for long contexts
}

interface EnergyConfig {
  enabled: boolean;
  costs: EnergyCosts;
  regenRate: number;      // Points per minute
  lowEnergyThreshold: number;  // Below this, effects kick in
  criticalThreshold: number;   // Below this, warns user
}

const DEFAULT_COSTS: EnergyCosts = {
  message: 2,
  toolCall: 5,
  llmCall: 3,
  longContext: 10,
};

const DEFAULT_CONFIG: EnergyConfig = {
  enabled: true,
  costs: DEFAULT_COSTS,
  regenRate: 5,  // 5 points per minute = full in 20 min
  lowEnergyThreshold: 30,
  criticalThreshold: 10,
};
```

### Energy Manager

```typescript
// packages/core/src/energy/manager.ts

class EnergyManager {
  private state: EnergyState;
  private config: EnergyConfig;
  private storage: EnergyStorage;
  private regenInterval?: NodeJS.Timeout;

  constructor(config: EnergyConfig, storage: EnergyStorage) {
    this.config = config;
    this.storage = storage;
    this.state = {
      current: 100,
      max: 100,
      regenRate: config.regenRate,
      lastUpdate: new Date().toISOString(),
    };
  }

  async initialize(): Promise<void> {
    // Load persisted state
    const saved = await this.storage.load();
    if (saved) {
      this.state = saved;
      // Apply time-based regeneration since last update
      this.applyOfflineRegen();
    }

    // Start regeneration timer
    this.startRegen();
  }

  consume(action: keyof EnergyCosts): boolean {
    if (!this.config.enabled) return true;

    const cost = this.config.costs[action];

    if (this.state.current < cost) {
      return false; // Not enough energy
    }

    this.state.current = Math.max(0, this.state.current - cost);
    this.state.lastUpdate = new Date().toISOString();
    this.persist();

    return true;
  }

  getState(): EnergyState {
    return { ...this.state };
  }

  getEffects(): EnergyEffects {
    const level = this.state.current;

    if (level <= this.config.criticalThreshold) {
      return {
        personality: 'exhausted',
        responseModifier: 0.5,  // Shorter responses
        delayMs: 500,           // Slower
        message: '*yawns* Running low on energy...',
      };
    }

    if (level <= this.config.lowEnergyThreshold) {
      return {
        personality: 'tired',
        responseModifier: 0.8,
        delayMs: 200,
        message: 'Getting a bit tired...',
      };
    }

    return {
      personality: 'energetic',
      responseModifier: 1,
      delayMs: 0,
      message: null,
    };
  }

  rest(amount: number = 20): void {
    this.state.current = Math.min(this.state.max, this.state.current + amount);
    this.persist();
  }

  private startRegen(): void {
    this.regenInterval = setInterval(() => {
      if (this.state.current < this.state.max) {
        this.state.current = Math.min(
          this.state.max,
          this.state.current + 1
        );
        this.persist();
      }
    }, 60000 / this.config.regenRate);  // Regen tick
  }

  private applyOfflineRegen(): void {
    const lastUpdate = new Date(this.state.lastUpdate);
    const now = new Date();
    const minutesElapsed = (now.getTime() - lastUpdate.getTime()) / 60000;
    const regenAmount = Math.floor(minutesElapsed * this.config.regenRate);

    this.state.current = Math.min(this.state.max, this.state.current + regenAmount);
  }

  private async persist(): Promise<void> {
    await this.storage.save(this.state);
  }

  stop(): void {
    if (this.regenInterval) {
      clearInterval(this.regenInterval);
    }
  }
}
```

### Energy Display

```typescript
// packages/terminal/src/components/EnergyBar.tsx

import { Box, Text } from 'ink';

interface EnergyBarProps {
  current: number;
  max: number;
}

export function EnergyBar({ current, max }: EnergyBarProps) {
  const percentage = Math.round((current / max) * 100);
  const barWidth = 20;
  const filled = Math.round((current / max) * barWidth);
  const empty = barWidth - filled;

  const color = percentage > 50 ? 'green' :
                percentage > 20 ? 'yellow' : 'red';

  const emoji = percentage > 70 ? '⚡' :
                percentage > 30 ? '🔋' : '🪫';

  return (
    <Box>
      <Text>{emoji} </Text>
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(empty)}</Text>
      <Text> {percentage}%</Text>
    </Box>
  );
}
```

### Personality Modifiers

```typescript
// packages/core/src/energy/personality.ts

interface PersonalityEffect {
  promptModifier?: string;
  responseLengthFactor: number;
  includeYawns: boolean;
  processingDelay: number;
}

const PERSONALITIES: Record<string, PersonalityEffect> = {
  energetic: {
    responseLengthFactor: 1,
    includeYawns: false,
    processingDelay: 0,
  },
  tired: {
    promptModifier: 'You are feeling a bit tired. Keep responses concise.',
    responseLengthFactor: 0.8,
    includeYawns: false,
    processingDelay: 200,
  },
  exhausted: {
    promptModifier: 'You are very tired. Give minimal but helpful responses. Occasionally mention being tired.',
    responseLengthFactor: 0.5,
    includeYawns: true,
    processingDelay: 500,
  },
};

function applyPersonality(
  systemPrompt: string,
  effect: PersonalityEffect
): string {
  if (effect.promptModifier) {
    return `${systemPrompt}\n\n${effect.promptModifier}`;
  }
  return systemPrompt;
}
```

## Implementation Steps

### Step 1: Create Energy Types
- [x] Define EnergyState interface
- [x] Define EnergyCosts interface
- [x] Define EnergyConfig interface
- [x] Create defaults

**Files:**
- `packages/core/src/energy/types.ts`

### Step 2: Implement EnergyManager
- [x] Create EnergyManager class
- [x] Add consumption logic
- [x] Add regeneration logic
- [x] Add offline regeneration
- [x] Add effects calculation

**Files:**
- `packages/core/src/energy/manager.ts`

### Step 3: Implement Storage
- [x] Create EnergyStorage class
- [x] Add persistence

**Files:**
- `packages/core/src/energy/storage.ts`

### Step 4: Add Personality Effects
- [x] Define personality types
- [x] Create prompt modifiers
- [x] Add response modifiers

**Files:**
- `packages/core/src/energy/personality.ts`

### Step 5: Add UI Components
- [x] Create EnergyBar component
- [x] Integrate into Status
- [x] Add low energy warnings

**Files:**
- `packages/terminal/src/components/EnergyBar.tsx`
- `packages/terminal/src/components/Status.tsx`

### Step 6: Integrate with Agent
- [x] Add EnergyManager to AgentLoop
- [x] Consume energy on actions
- [x] Apply personality effects
- [x] Add /rest command

**Files:**
- `packages/core/src/agent/loop.ts`
- `packages/core/src/commands/builtin.ts`

### Step 7: Add Tests
- [x] Test energy consumption
- [x] Test regeneration
- [x] Test effects

**Files:**
- `packages/core/tests/energy.test.ts`

## Testing Strategy

```typescript
describe('EnergyManager', () => {
  it('should consume energy for actions');
  it('should regenerate over time');
  it('should apply offline regeneration');
  it('should return correct effects at thresholds');
  it('should persist state');
});

describe('EnergyBar', () => {
  it('should render correct fill level');
  it('should change color at thresholds');
});
```

## Rollout Plan

1. Create energy types
2. Implement manager
3. Add storage
4. Create personality effects
5. Build UI components
6. Integrate with agent
7. Add tests
8. Make configurable

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users find it annoying | Medium | Make easily disableable |
| Blocks important work | High | Energy costs never block, just affect personality |
| Unfun/gimmicky | Low | Tune effects to be subtle |

---

## Approval

- [x] Technical design approved
- [x] Implementation steps clear
- [x] Tests defined
- [x] Ready to implement

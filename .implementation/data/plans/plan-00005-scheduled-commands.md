# Plan: Scheduled Commands System

**Plan ID:** 00005
**Status:** Completed
**Priority:** Medium
**Estimated Effort:** Medium (3 days)
**Dependencies:** plan-00002 (Error Handling)

---

## Overview

Implement a scheduled task system allowing users to schedule recurring commands with cron-like syntax. The system will execute commands at specified intervals while the assistant is running.

## Current State

- No scheduling capability exists
- Commands are only executed on-demand
- No persistent background task system
- No cron parser or scheduler

## Requirements

### Functional
1. Support cron-like syntax for scheduling
2. Persist schedules across sessions
3. Execute scheduled commands in background
4. Support common presets (hourly, daily, weekly)
5. Allow listing, adding, and removing schedules

### Non-Functional
1. Minimal resource usage when idle
2. Accurate timing (within 1 minute precision)
3. Graceful handling of missed schedules
4. Clear logging of scheduled executions

## Technical Design

### Schedule Definition

```typescript
// packages/core/src/scheduler/types.ts

interface Schedule {
  id: string;
  name: string;
  cron: string;              // Cron expression
  command: string;           // Command or message to execute
  enabled: boolean;
  lastRun?: string;          // ISO timestamp
  nextRun?: string;          // ISO timestamp
  runCount: number;
  createdAt: string;
  options: ScheduleOptions;
}

interface ScheduleOptions {
  maxRuns?: number;          // Stop after N runs
  timeout?: number;          // Max execution time
  retryOnFailure?: boolean;  // Retry failed executions
  notifyOnComplete?: boolean;// Show notification when done
}

// Cron presets
const PRESETS = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@weekdays': '0 9 * * 1-5',
} as const;
```

### Scheduler Implementation

```typescript
// packages/core/src/scheduler/scheduler.ts

import { CronJob } from 'cron';

class Scheduler {
  private schedules: Map<string, Schedule> = new Map();
  private jobs: Map<string, CronJob> = new Map();
  private storage: ScheduleStorage;
  private executor: CommandExecutor;

  constructor(storage: ScheduleStorage, executor: CommandExecutor) {
    this.storage = storage;
    this.executor = executor;
  }

  async initialize(): Promise<void> {
    // Load persisted schedules
    const saved = await this.storage.load();
    for (const schedule of saved) {
      if (schedule.enabled) {
        this.startJob(schedule);
      }
      this.schedules.set(schedule.id, schedule);
    }
  }

  async addSchedule(schedule: Omit<Schedule, 'id' | 'createdAt' | 'runCount'>): Promise<Schedule> {
    const id = generateId();
    const full: Schedule = {
      ...schedule,
      id,
      createdAt: new Date().toISOString(),
      runCount: 0,
    };

    // Validate cron expression
    if (!this.isValidCron(full.cron)) {
      throw new SchedulerError(`Invalid cron expression: ${full.cron}`);
    }

    this.schedules.set(id, full);
    if (full.enabled) {
      this.startJob(full);
    }
    await this.storage.save(Array.from(this.schedules.values()));

    return full;
  }

  async removeSchedule(id: string): Promise<void> {
    this.stopJob(id);
    this.schedules.delete(id);
    await this.storage.save(Array.from(this.schedules.values()));
  }

  private startJob(schedule: Schedule): void {
    const job = new CronJob(
      schedule.cron,
      () => this.executeSchedule(schedule.id),
      null,
      true
    );

    this.jobs.set(schedule.id, job);

    // Update next run time
    schedule.nextRun = job.nextDate().toISO();
  }

  private stopJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  private async executeSchedule(id: string): Promise<void> {
    const schedule = this.schedules.get(id);
    if (!schedule) return;

    try {
      await this.executor.execute(schedule.command, {
        timeout: schedule.options.timeout,
        source: `scheduled:${schedule.name}`,
      });

      schedule.lastRun = new Date().toISOString();
      schedule.runCount++;

      // Check max runs
      if (schedule.options.maxRuns && schedule.runCount >= schedule.options.maxRuns) {
        schedule.enabled = false;
        this.stopJob(id);
      }

      // Update next run
      const job = this.jobs.get(id);
      if (job) {
        schedule.nextRun = job.nextDate().toISO();
      }

      await this.storage.save(Array.from(this.schedules.values()));
    } catch (error) {
      console.error(`Scheduled task ${schedule.name} failed:`, error);
      if (!schedule.options.retryOnFailure) {
        // Optionally disable on repeated failures
      }
    }
  }

  listSchedules(): Schedule[] {
    return Array.from(this.schedules.values());
  }

  private isValidCron(expression: string): boolean {
    try {
      new CronJob(expression, () => {});
      return true;
    } catch {
      return false;
    }
  }
}
```

### Schedule Storage

```typescript
// packages/core/src/scheduler/storage.ts

class ScheduleStorage {
  private filePath: string;

  constructor(configDir: string) {
    this.filePath = join(configDir, 'schedules.json');
  }

  async load(): Promise<Schedule[]> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  async save(schedules: Schedule[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(schedules, null, 2));
  }
}
```

### Commands

```typescript
// Add to packages/core/src/commands/builtin.ts

// /schedule list - List all schedules
// /schedule add "<cron>" "<command>" [name] - Add new schedule
// /schedule remove <id> - Remove schedule
// /schedule enable <id> - Enable schedule
// /schedule disable <id> - Disable schedule

const scheduleCommand: Command = {
  name: 'schedule',
  description: 'Manage scheduled tasks',
  usage: '/schedule <list|add|remove|enable|disable> [args]',
  execute: async (args, context) => {
    const [action, ...rest] = args.split(' ');
    const scheduler = context.scheduler;

    switch (action) {
      case 'list':
        const schedules = scheduler.listSchedules();
        if (schedules.length === 0) {
          return 'No scheduled tasks.';
        }
        return formatScheduleList(schedules);

      case 'add':
        // Parse: /schedule add "0 * * * *" "git status" hourly-status
        const match = rest.join(' ').match(/"([^"]+)"\s+"([^"]+)"(?:\s+(.+))?/);
        if (!match) {
          return 'Usage: /schedule add "<cron>" "<command>" [name]';
        }
        const [, cron, command, name] = match;
        const schedule = await scheduler.addSchedule({
          name: name || `task-${Date.now()}`,
          cron: PRESETS[cron as keyof typeof PRESETS] || cron,
          command,
          enabled: true,
          options: {},
        });
        return `Created schedule: ${schedule.name} (${schedule.id})`;

      case 'remove':
        await scheduler.removeSchedule(rest[0]);
        return `Removed schedule: ${rest[0]}`;

      // ... enable/disable handlers
    }
  },
};
```

## Implementation Steps

### Step 1: Add Dependencies
- [ ] Add `cron` package dependency
- [ ] Create scheduler module structure

**Files:**
- `package.json`
- `packages/core/src/scheduler/index.ts`

### Step 2: Implement Core Scheduler
- [ ] Create Schedule types
- [ ] Implement Scheduler class
- [ ] Add cron validation
- [ ] Implement job management

**Files:**
- `packages/core/src/scheduler/types.ts`
- `packages/core/src/scheduler/scheduler.ts`

### Step 3: Implement Storage
- [ ] Create ScheduleStorage class
- [ ] Add load/save functionality
- [ ] Handle migrations

**Files:**
- `packages/core/src/scheduler/storage.ts`

### Step 4: Add Commands
- [ ] Implement /schedule command
- [ ] Add list, add, remove actions
- [ ] Add enable/disable actions
- [ ] Format output nicely

**Files:**
- `packages/core/src/commands/builtin.ts`

### Step 5: Integrate with Agent
- [ ] Initialize scheduler in AgentLoop
- [ ] Pass executor for command running
- [ ] Handle scheduled output display

**Files:**
- `packages/core/src/agent/loop.ts`
- `packages/core/src/client.ts`

### Step 6: Add Tests
- [ ] Test schedule CRUD
- [ ] Test cron parsing
- [ ] Test execution timing
- [ ] Test persistence

**Files:**
- `packages/core/tests/scheduler.test.ts`

## Testing Strategy

```typescript
describe('Scheduler', () => {
  it('should validate cron expressions');
  it('should execute jobs at correct times');
  it('should persist schedules');
  it('should handle preset aliases');
  it('should stop after max runs');
});

describe('Schedule Commands', () => {
  it('should list schedules');
  it('should add new schedule');
  it('should remove schedule');
  it('should enable/disable schedules');
});
```

## Rollout Plan

1. Add cron dependency
2. Implement core scheduler
3. Add persistence
4. Create commands
5. Integrate with agent
6. Add documentation

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Missed schedules on app restart | Medium | Log missed, optionally catch up |
| Resource usage from many schedules | Low | Limit max schedules, warn users |
| Long-running scheduled tasks | Medium | Timeout enforcement |

---


## Open Questions

- TBD
## Approval

- [ ] Technical design approved
- [ ] Implementation steps clear
- [ ] Tests defined
- [ ] Ready to implement

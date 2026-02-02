# Plan: Background Daemon for Schedules/Heartbeat

**Plan ID:** 00015
**Status:** Planned
**Priority:** High
**Estimated Effort:** Large (3-5 days)
**Dependencies:** 00005, 00007

---

## Overview

Run schedules and heartbeat even when the UI is closed by adding a lightweight background daemon.

---

## Implementation Steps

### Step 1: Daemon design
- [ ] Define daemon lifecycle (start, stop, status)
- [ ] Decide on IPC protocol for sending messages

### Step 2: Daemon runtime
- [ ] Create a headless runner to tick schedules/heartbeat
- [ ] Persist ownership/locks per session

### Step 3: CLI integration
- [ ] Add `assistants daemon` command (start/stop/status)
- [ ] Emit errors to logs + health file

### Step 4: Tests
- [ ] Add daemon start/stop tests
- [ ] Add schedule execution tests under daemon

---


## Current State

TBD

## Requirements

### Functional
- [ ] TBD

### Non-Functional
- [ ] TBD

## Technical Design

TBD

## Testing Strategy

TBD

## Rollout Plan

TBD

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| TBD | TBD | TBD |

## Open Questions

- TBD
## Approval

- [ ] Technical design approved
- [ ] Implementation steps clear
- [ ] Tests defined
- [ ] Ready to implement

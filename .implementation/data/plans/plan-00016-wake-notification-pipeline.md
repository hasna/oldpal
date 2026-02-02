# Plan: Wake/Notification Pipeline

**Plan ID:** 00016
**Status:** Planned
**Priority:** High
**Estimated Effort:** Medium (2-3 days)
**Dependencies:** 00015

---

## Overview

Add a wake/notification system for due schedules, recovery alerts, and background agent events.

---

## Implementation Steps

### Step 1: Event pipeline
- [ ] Define event types (schedule due, recovery, error)
- [ ] Persist last notification state

### Step 2: Delivery targets
- [ ] Terminal notifications
- [ ] Optional desktop notification hook

### Step 3: Wake triggers
- [ ] Wake UI when a critical event arrives
- [ ] Provide `assistants notify` for testing

### Step 4: Tests
- [ ] Event delivery tests
- [ ] Wake path tests

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

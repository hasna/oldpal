# oldpal Roadmap

## Overview

This document outlines the planned features, missing functionality, and detailed implementation guides for oldpal development.

**Last Updated:** 2025-02-01

---

## Status Tracking

### Legend

| Symbol | Meaning |
|--------|---------|
| ⬜ | Not Started |
| 🟨 | In Progress |
| 🟩 | Complete |
| 🟥 | Blocked |

### Progress Overview

```
HIGH PRIORITY     [████████░░░░░░░░░░░░] 40% (4/10 subtasks)
MEDIUM PRIORITY   [██░░░░░░░░░░░░░░░░░░] 10% (2/20 subtasks)
LOW PRIORITY      [░░░░░░░░░░░░░░░░░░░░]  0% (0/15 subtasks)
─────────────────────────────────────────────────────────
OVERALL           [███░░░░░░░░░░░░░░░░░] 13% (6/45 subtasks)
```

### Detailed Status Table

| # | Item | Priority | Progress | Status | Effort | Owner | Updated |
|---|------|----------|----------|--------|--------|-------|---------|
| 1 | Prompt/Agent Hooks | 🔴 High | ⬜ 0% | Stub exists | M | - | - |
| 2 | Error Handling & Recovery | 🔴 High | 🟨 20% | Basic errors | L | - | - |
| 3 | Input Validation | 🔴 High | 🟨 30% | Partial | M | - | - |
| 4 | Security Audit | 🔴 High | 🟨 40% | Basic checks | M | - | - |
| 5 | Scheduled Commands | 🟡 Med | ⬜ 0% | Planned | L | - | - |
| 6 | Context Summarization | 🟡 Med | ⬜ 0% | Not started | M | - | - |
| 7 | Heartbeat System | 🟡 Med | ⬜ 0% | Planned | M | - | - |
| 8 | Test Coverage | 🟡 Med | 🟨 25% | Partial | L | - | - |
| 9 | Stamina/Energy System | 🟢 Low | ⬜ 0% | Planned | M | - | - |
| 10 | Voice Features | 🟢 Low | ⬜ 5% | Stub only | L | - | - |
| 11 | Web UI | 🟢 Low | ⬜ 0% | Not started | L | - | - |

### Subtask Breakdown

#### 1. Prompt/Agent Hooks (0/4)
- [ ] Inject LLMClient into HookExecutor
- [ ] Implement executePromptHook
- [ ] Implement executeAgentHook
- [ ] Add tests for hook execution

#### 2. Error Handling & Recovery (1/5)
- [x] Basic error catching exists
- [ ] Create error type hierarchy
- [ ] Add error categorization
- [ ] Implement retry logic
- [ ] Add error aggregation

#### 3. Input Validation (2/6)
- [x] Basic path validation in filesystem
- [x] Bash command allowlist
- [ ] JSON schema validation for tools
- [ ] LLM response validation
- [ ] Message size limits
- [ ] Symlink resolution

#### 4. Security Audit (2/5)
- [x] Bash allowlist implemented
- [x] Temp folder restriction for writes
- [ ] Command parsing before regex
- [ ] Connector verification
- [ ] Audit logging

#### 5. Scheduled Commands (0/5)
- [ ] Create scheduler service
- [ ] SQLite persistence
- [ ] /schedule command
- [ ] Background task runner
- [ ] Missed task handling

#### 6. Context Summarization (0/4)
- [ ] Summarizer module
- [ ] Trigger conditions
- [ ] LLM summarization prompt
- [ ] Context integration

#### 7. Heartbeat System (0/5)
- [ ] State machine implementation
- [ ] Background heartbeat process
- [ ] State persistence
- [ ] Wake/sleep triggers
- [ ] /status integration

#### 8. Test Coverage (2/8)
- [x] Core agent tests
- [x] Tool registry tests
- [ ] Terminal UI tests
- [ ] Error path tests
- [ ] Hook execution tests
- [ ] Integration tests
- [ ] Session tests
- [ ] Connector tests

#### 9. Stamina/Energy System (0/4)
- [ ] Stamina tracking
- [ ] Energy calculation
- [ ] Behavior modulation
- [ ] Configuration

#### 10. Voice Features (0/4)
- [ ] Whisper STT integration
- [ ] ElevenLabs TTS integration
- [ ] Streaming audio
- [ ] Voice commands

#### 11. Web UI (0/5)
- [ ] React setup
- [ ] Component library
- [ ] API layer
- [ ] Authentication
- [ ] Deploy config

---

## Priority Summary

| Item | Priority | Status | Effort | Dependencies |
|------|----------|--------|--------|--------------|
| Prompt/Agent Hooks | High | Stub | Medium | LLMClient injection |
| Error Handling & Recovery | High | Minimal | Large | Error types first |
| Input Validation | High | Partial | Medium | JSON schema lib |
| Security Audit (Bash/Connectors) | High | Basic | Medium | None |
| Scheduled Commands | Medium | Planned | Large | SQLite, heartbeat |
| Context Summarization | Medium | None | Medium | LLM prompt tuning |
| Heartbeat System | Medium | Planned | Medium | None |
| Test Coverage Expansion | Medium | Partial | Large | Testing framework |
| Stamina/Energy System | Low | Planned | Medium | Heartbeat |
| Voice Features (STT/TTS) | Low | Stub | Large | Phase 3 |
| Web UI | Low | None | Large | Phase 4 |

---

## HIGH PRIORITY

### 1. Implement Prompt & Agent Hooks

**File:** `packages/core/src/hooks/executor.ts` (lines 172-200)

**Current State:** Both `executePromptHook` and `executeAgentHook` are stubs that just log and return null.

**Implementation:**

```
executePromptHook (single-turn LLM decision):
├── Accept hook.prompt template
├── Inject HookInput data into prompt
├── Call LLM with prompt (need to pass LLMClient to HookExecutor)
├── Parse LLM response for decision (allow/deny/modify)
├── Return HookOutput with:
│   ├── continue: boolean
│   ├── stopReason: string (if blocked)
│   ├── permissionDecision: 'allow'|'deny'|'ask' (optional)
│   └── modifiedInput: object (optional, to modify tool input)
└── Handle timeout

executeAgentHook (multi-turn subagent):
├── Accept hook.prompt as task description
├── Create a sub-AgentLoop with restricted tools
├── Run subagent with hook.prompt + HookInput as context
├── Collect subagent's final decision/output
├── Return HookOutput based on subagent conclusion
└── Handle timeout and max turns
```

**Dependencies:**
- Need to inject `LLMClient` into `HookExecutor`
- Need to create lightweight subagent spawning mechanism

**Files to modify:**
- `packages/core/src/hooks/executor.ts`
- `packages/core/src/agent/loop.ts` (pass LLM client)

---

### 2. Improve Error Handling & Recovery

**Current State:** Most errors are silently caught or return generic strings.

**Implementation:**

```
1. Create error types (packages/core/src/errors.ts):
   ├── OldpalError (base class)
   ├── ToolExecutionError
   ├── LLMError
   ├── ConfigurationError
   ├── ConnectorError
   ├── HookError
   └── ValidationError

2. Add error categorization:
   ├── Recoverable vs Fatal
   ├── User-caused vs System-caused
   └── Retryable vs Non-retryable

3. Implement retry logic:
   ├── For LLM calls: exponential backoff on rate limits
   ├── For tools: configurable retry count
   └── For connectors: auth refresh + retry

4. Add error context:
   ├── Stack traces in debug mode
   ├── Actionable suggestions ("Try: ...")
   └── Related documentation links

5. Error aggregation:
   ├── Track error frequency
   ├── Detect patterns (e.g., same tool failing)
   └── Surface to /status command
```

**Files to create:**
- `packages/core/src/errors.ts`

**Files to modify:**
- `packages/core/src/agent/loop.ts`
- `packages/core/src/tools/*.ts` (all tool files)
- `packages/core/src/llm/anthropic.ts`
- `packages/core/src/commands/executor.ts`

---

### 3. Input Validation & Sanitization

**Current State:** Limited validation, some path checks but inconsistent.

**Implementation:**

```
1. Tool input validation (before execution):
   ├── Validate against JSON schema in tool.parameters
   ├── Check required fields present
   ├── Type coercion with limits
   └── Sanitize strings (trim, length limits)

2. LLM response validation:
   ├── Validate tool_use blocks have valid tool names
   ├── Validate tool inputs match schema
   └── Reject malformed responses gracefully

3. Path sanitization (filesystem.ts, bash.ts):
   ├── Resolve symlinks before validation
   ├── Block path traversal more robustly
   └── Whitelist allowed directories

4. Message size limits:
   ├── Max user input length (configurable, default 100k chars)
   ├── Max tool output length (truncate at 50k chars)
   └── Max conversation history (trigger summarization)
```

**Files to create:**
- `packages/core/src/validation/index.ts`
- `packages/core/src/validation/schemas.ts`

**Files to modify:**
- `packages/core/src/tools/registry.ts` (add validation before execute)
- `packages/core/src/tools/filesystem.ts`
- `packages/core/src/tools/bash.ts`
- `packages/core/src/agent/loop.ts`

---

### 4. Security Audit: Bash Tool & Connector Discovery

#### Bash Tool Issues

**File:** `packages/core/src/tools/bash.ts`

**Current problems:**
```
├── Regex patterns can be bypassed:
│   ├── Command substitution: cat$(echo x)
│   ├── Unicode homoglyphs
│   └── Encoded characters
├── Shell chaining check too simple:
│   └── /[;&|]/ doesn't catch $(...), backticks, <()
└── No sandbox/container execution
```

**Fixes needed:**
```
├── Use allowlist approach more strictly:
│   ├── Parse command into argv BEFORE checking
│   ├── Reject if ANY unknown token present
│   └── Block subshells entirely ($(), ``, <())
├── Add argument validation per command:
│   ├── cat: only allow file paths, no flags except -n
│   ├── grep: only allow -r, -i, -n, -l flags
│   ├── git: only allow specific read-only subcommands
│   └── find: block -exec, -delete flags
└── Consider running in restricted container (future)
```

#### Connector Discovery Issues

**File:** `packages/core/src/tools/connector.ts`

**Current problems:**
```
├── Auto-discovers ANY connect-* binary in PATH
├── Malicious binary could be named connect-evil
├── No signature/checksum verification
└── No permission model for connector actions
```

**Fixes needed:**
```
├── Require explicit connector allowlist by default
│   └── Config: connectors: ["notion", "gmail"] instead of ["*"]
├── Add connector verification:
│   ├── Check if installed from known npm @hasnaxyz scope
│   ├── Optional: verify executable checksum
│   └── Show warning for unknown/unverified connectors
├── Permission scoping:
│   ├── Mark connectors as read-only vs read-write
│   └── Per-connector tool restrictions in config
└── Audit logging:
    └── Log all connector invocations with args
```

---

## MEDIUM PRIORITY

### 5. Scheduled Commands

**Priority:** High
**Status:** Planned

Ability to schedule commands to run at specific times, either fixed or dynamic.

#### Features
- Cron-like syntax for recurring tasks
- One-time scheduled execution
- Example: `/schedule "9:00am" /email check`

#### Implementation

**Files to create:**
- `packages/core/src/scheduler/index.ts`
- `packages/core/src/scheduler/store.ts`
- `packages/core/src/commands/schedule.ts`

**Data model:**
```typescript
interface ScheduledTask {
  id: string;
  cron?: string;           // "0 9 * * *"
  once?: string;           // ISO timestamp
  command: string;         // "/email check"
  enabled: boolean;
  lastRun?: string;
  nextRun: string;
  createdAt: string;
}
```

**Scheduler service:**
```
├── Load schedules from SQLite on startup
├── Background interval (every minute) checks due tasks
├── Execute command via CommandExecutor
├── Update lastRun, compute nextRun
└── Handle missed tasks (run immediately or skip based on config)
```

**Commands:**
```
/schedule "9:00am" /email check     → create daily task
/schedule "*/15 * * * *" /sync      → cron syntax
/schedule list                       → show all tasks
/schedule cancel <id>                → remove task
/schedule enable/disable <id>        → toggle
/schedule next                       → show upcoming tasks
```

**Persistence:**
- SQLite table: `scheduled_tasks`
- Location: `~/.oldpal/memory.db`

---

### 6. Context Summarization

**Priority:** Medium
**Status:** Not implemented

Automatically summarize long conversations to stay within context limits.

#### Implementation

**Files to create:**
- `packages/core/src/agent/summarizer.ts`

**Files to modify:**
- `packages/core/src/agent/context.ts`

**Trigger conditions:**
```
├── Message count > threshold (default: 50 messages)
├── Token count > threshold (default: 80% of context window)
└── Manual /summarize command
```

**Summarization flow:**
```
├── Take oldest N messages (preserve last 10)
├── Call LLM with summarization prompt
├── Replace old messages with summary message
└── Preserve referenced tool calls/results
```

**Summary message format:**
```typescript
{
  role: "system",
  content: "[Summary of previous conversation]\n...",
  metadata: {
    summarizedAt: timestamp,
    originalMessageCount: number,
    summarizedRange: [startId, endId]
  }
}
```

**Integration:**
```
├── Check before each LLM call
├── Preserve important context (user preferences, decisions)
└── Allow user to expand/view original if needed
```

---

### 7. Agent Heartbeat System

**Priority:** High
**Status:** Planned

A heartbeat mechanism to determine if the agent is "awake" and responsive.

#### Heartbeat States
- **Awake**: Agent is active, processing, responding
- **Idle**: Agent is available but not actively working
- **Resting**: Agent is in low-power mode (low stamina/energy)
- **Sleeping**: Agent is offline, only emergency triggers wake it

#### Implementation

**Files to create:**
- `packages/core/src/heartbeat/index.ts`
- `packages/core/src/heartbeat/states.ts`

**State machine:**
```
States: AWAKE → IDLE → RESTING → SLEEPING

Transitions:
├── AWAKE → IDLE: No activity for 5 min
├── IDLE → RESTING: No activity for 15 min
├── RESTING → SLEEPING: No activity for 30 min
├── ANY → AWAKE: User interaction or scheduled task
```

**Heartbeat data:**
```typescript
interface HeartbeatData {
  state: 'awake' | 'idle' | 'resting' | 'sleeping';
  lastHeartbeat: string;
  lastActivity: string;
  uptime: number;
  tasksCompleted: number;
  nextScheduledTask?: string;
}
```

**Background heartbeat:**
```
├── Emit heartbeat event every 30 seconds
├── Write to ~/.oldpal/heartbeat.json
├── External processes can read state
└── Used by scheduler to decide if agent is available
```

**Wake mechanisms:**
- User input
- Scheduled task due
- External trigger (file watch, webhook)

**Sleep conditions:**
- Extended idle period (configurable, default 30min)
- Energy below threshold
- Explicit `/sleep` command
- System resource constraints

#### Heartbeat Data Example
```json
{
  "state": "awake",
  "lastHeartbeat": "2025-01-31T18:45:00Z",
  "lastActivity": "2025-01-31T18:44:30Z",
  "stamina": 85,
  "energy": 72,
  "uptime": "4h 23m",
  "tasksCompleted": 47,
  "nextScheduledTask": "2025-01-31T19:00:00Z"
}
```

---

### 8. Test Coverage Expansion

**Priority:** Medium
**Status:** Partial

#### Current Gaps
```
Missing tests:
├── Terminal UI components (Ink)
├── Error paths in all tools
├── Hook execution flows (prompt/agent hooks)
├── Connector discovery edge cases
├── Session switching
├── Message queue processing
└── Context summarization (when implemented)
```

#### Implementation

**New test directories:**
```
packages/terminal/tests/
├── App.test.tsx        - Main app flow
├── Input.test.tsx      - Input handling, autocomplete
├── Messages.test.tsx   - Message rendering
└── SessionSelector.test.tsx
```

**New test files:**
```
packages/core/tests/
├── error-handling.test.ts  - All error paths
├── validation.test.ts      - Input validation
├── scheduler.test.ts       - (when implemented)
├── heartbeat.test.ts       - (when implemented)
└── summarizer.test.ts      - (when implemented)
```

**Integration tests:**
```
packages/core/tests/integration/
├── conversation-flow.test.ts  - Full conversation
├── tool-execution.test.ts     - Tools with mocks
└── session-persistence.test.ts - Save/restore
```

---

## LOW PRIORITY

### 9. Agent Stamina System

**Priority:** Medium
**Status:** Planned

Implement a stamina/energy system to prevent agent burnout and encourage sustainable pacing.

#### Stamina
- Depletes when performing rapid successive actions
- Regenerates during idle periods
- High stamina = faster, more complex operations allowed
- Low stamina = agent slows down, takes breaks, suggests deferring tasks

#### Energy (Human-Correlated)
- Follows human circadian rhythm patterns
- Morning: Energy ramps up (6am-10am)
- Midday: Peak energy (10am-2pm)
- Afternoon: Gradual decline (2pm-6pm)
- Evening: Low energy, maintenance mode (6pm-10pm)
- Night: Minimal activity, background tasks only (10pm-6am)

#### Behavior Effects
| Stamina | Energy | Agent Behavior |
|---------|--------|----------------|
| High | High | Full speed, complex tasks, proactive suggestions |
| High | Low | Capable but conservative, fewer suggestions |
| Low | High | Slower pace, rest breaks between tasks |
| Low | Low | Minimal activity, defer non-urgent tasks |

#### Configuration
```json
{
  "stamina": {
    "max": 100,
    "regenRate": 5,
    "costPerAction": 2,
    "rapidActionPenalty": 10
  },
  "energy": {
    "timezone": "local",
    "peakHours": [10, 14],
    "lowHours": [22, 6],
    "weekendMultiplier": 0.7
  }
}
```

---

### 10. Voice Features (Phase 3)

**Status:** Stub implemented

#### STT (Speech-to-Text)
- File: `packages/core/src/voice/stt.ts`
- Integration: Whisper API
- Currently throws: "Voice STT not implemented yet - coming in Phase 3"

#### TTS (Text-to-Speech)
- File: `packages/core/src/voice/tts.ts`
- Integration: ElevenLabs API
- Currently throws: "Voice TTS not implemented yet - coming in Phase 3"

---

### 11. Web UI (Phase 4)

**Status:** Not implemented

- File: `packages/web/src/index.ts`
- Currently only prints: "Web UI coming in Phase 4"
- Will provide browser-based alternative to terminal UI

---

## Implementation Order

1. **Phase 1**: Security & Stability
   - Input validation
   - Error handling
   - Bash/connector security audit

2. **Phase 2**: Core Infrastructure
   - Heartbeat system
   - Prompt/agent hooks

3. **Phase 3**: Features
   - Context summarization
   - Scheduled commands

4. **Phase 4**: Quality
   - Test coverage expansion
   - Documentation

5. **Phase 5**: Advanced
   - Stamina/energy system
   - Voice features
   - Web UI

---

---

## MAJOR INITIATIVES

### 12. Identity & Multi-Assistant System

**Priority:** High
**Status:** Planning
**Complexity:** Large (Architectural)

A comprehensive identity system that allows multiple assistants, each with multiple identities (emails, phones, addresses, preferences).

#### Problem Statement

Currently:
- Single agent with no persistent identity
- No way to store assistant preferences, contact info, or personal details
- No support for multiple assistants with different purposes

Need:
- Assistants should "know" their identity (name, email, phone, etc.)
- Support multiple identities per assistant (work email, personal email)
- Support multiple assistants (work assistant, personal assistant, project-specific)
- Identities should be accessible to the LLM for personalized responses

#### Architecture Design

```
~/.assistants/                          # Global config directory (renamed from .oldpal)
├── config.json                         # Global settings
├── assistants/                         # Multi-assistant support
│   ├── default/                        # Default assistant
│   │   ├── assistant.json              # Assistant metadata
│   │   ├── identity/                   # Identity data
│   │   │   ├── profile.json            # Name, bio, preferences
│   │   │   ├── contacts.json           # Emails, phones, addresses
│   │   │   ├── accounts.json           # Connected accounts
│   │   │   └── preferences.json        # Behavioral preferences
│   │   ├── sessions/                   # Session history
│   │   ├── memory/                     # Long-term memory
│   │   └── skills/                     # Assistant-specific skills
│   ├── work/                           # Work assistant
│   │   ├── assistant.json
│   │   ├── identity/
│   │   └── ...
│   └── personal/                       # Personal assistant
│       └── ...
└── shared/                             # Shared across assistants
    ├── connectors/                     # Connector configs
    ├── tools/                          # Custom tools
    └── hooks/                          # Global hooks
```

#### Data Models

**Assistant:**
```typescript
interface Assistant {
  id: string;                           // UUID
  name: string;                         // "Work Assistant"
  slug: string;                         // "work" (directory name)
  description?: string;
  createdAt: string;
  defaultIdentityId?: string;           // Primary identity
  settings: AssistantSettings;
}

interface AssistantSettings {
  model: string;                        // "claude-sonnet-4"
  systemPrompt?: string;
  allowedTools?: string[];
  allowedConnectors?: string[];
  maxTokensPerTurn?: number;
}
```

**Identity:**
```typescript
interface Identity {
  id: string;
  label: string;                        // "Work", "Personal"
  isDefault: boolean;
  profile: IdentityProfile;
  contacts: IdentityContacts;
  accounts: IdentityAccounts;
  preferences: IdentityPreferences;
}

interface IdentityProfile {
  name: string;                         // "John Doe"
  nickname?: string;                    // "John"
  title?: string;                       // "Software Engineer"
  company?: string;                     // "Acme Corp"
  bio?: string;
  avatar?: string;                      // Path to image
  timezone?: string;                    // "America/New_York"
  locale?: string;                      // "en-US"
}

interface IdentityContacts {
  emails: ContactEmail[];
  phones: ContactPhone[];
  addresses: ContactAddress[];
}

interface ContactEmail {
  address: string;
  label: string;                        // "work", "personal"
  isPrimary: boolean;
  connectorId?: string;                 // Link to gmail/outlook connector
}

interface ContactPhone {
  number: string;
  label: string;
  isPrimary: boolean;
}

interface ContactAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  label: string;
}

interface IdentityAccounts {
  github?: { username: string; token?: string };
  linear?: { workspace: string };
  notion?: { workspace: string };
  slack?: { workspace: string; userId: string };
  // ... extensible
}

interface IdentityPreferences {
  communication: {
    formalityLevel: 'casual' | 'professional' | 'formal';
    responseLength: 'brief' | 'detailed' | 'adaptive';
    useEmoji: boolean;
  };
  workHours?: {
    start: string;                      // "09:00"
    end: string;                        // "17:00"
    timezone: string;
    workDays: number[];                 // [1,2,3,4,5] = Mon-Fri
  };
  notifications?: {
    doNotDisturb: boolean;
    quietHours?: { start: string; end: string };
  };
}
```

#### Commands

```
/assistant list                         # List all assistants
/assistant create <name>                # Create new assistant
/assistant switch <name>                # Switch active assistant
/assistant delete <name>                # Delete assistant
/assistant current                      # Show current assistant

/identity list                          # List identities for current assistant
/identity create <label>                # Create new identity
/identity switch <label>                # Switch active identity
/identity edit                          # Open identity editor
/identity show                          # Show current identity details

/identity set name "John Doe"           # Quick set profile fields
/identity set email work "john@work.com"
/identity set phone personal "+1234567890"
/identity set preference formality professional
```

#### System Prompt Integration

Identity is automatically injected into system prompt:
```
You are an AI assistant with the following identity:

Name: John Doe
Role: Software Engineer at Acme Corp
Primary Email: john@work.com
Timezone: America/New_York
Communication Style: Professional, detailed responses

When composing emails, signing documents, or representing the user,
use this identity information appropriately.
```

#### Implementation Steps

1. **Phase 1: Data Layer**
   - [ ] Create identity data models
   - [ ] Create assistant data models
   - [ ] Implement file-based storage
   - [ ] Migration from current .oldpal structure

2. **Phase 2: Core Integration**
   - [ ] Identity loader in agent loop
   - [ ] System prompt injection
   - [ ] Identity context for tools
   - [ ] Assistant switching in registry

3. **Phase 3: Commands**
   - [ ] /assistant commands
   - [ ] /identity commands
   - [ ] Interactive identity editor

4. **Phase 4: UI**
   - [ ] Identity display in status bar
   - [ ] Assistant selector
   - [ ] Identity quick-switch

#### Files to Create
```
packages/core/src/identity/
├── index.ts
├── types.ts
├── loader.ts
├── storage.ts
└── prompt.ts

packages/core/src/assistant/
├── index.ts
├── types.ts
├── registry.ts
└── storage.ts
```

---

### 13. Rename: oldpal → assistants

**Priority:** High
**Status:** Planning
**Complexity:** Medium (Refactoring)

Rebrand the entire application from "oldpal" to "assistants".

#### Rationale

- "assistants" better describes multi-assistant functionality
- More professional/generic name
- Aligns with identity system architecture
- npm package: `@hasna/assistants`

#### Scope of Changes

**Package Names:**
```
@hasna/oldpal        → @hasna/assistants
@oldpal/core         → @assistants/core
@oldpal/terminal     → @assistants/terminal
@oldpal/shared       → @assistants/shared
@oldpal/web          → @assistants/web
```

**Directory Names:**
```
~/.oldpal/           → ~/.assistants/
.oldpal/             → .assistants/       (project-level)
```

**Binary/CLI:**
```
oldpal               → assistants
```

**Code References:**
- All imports from `@oldpal/*`
- All references to `.oldpal` paths
- All "oldpal" strings in UI
- README, docs, comments

#### Migration Strategy

1. **Deprecation Period**
   - Keep `oldpal` binary as alias
   - Symlink `~/.oldpal` → `~/.assistants`
   - Show deprecation warning

2. **Migration Script**
   ```bash
   assistants migrate    # Migrate from oldpal
   ```
   - Move `~/.oldpal/*` to `~/.assistants/*`
   - Update config paths
   - Preserve all data

3. **Full Cutover**
   - Remove old package from npm
   - Remove symlinks
   - Update all documentation

#### Implementation Checklist

**Phase 1: Package Rename**
- [ ] Rename workspace packages in package.json
- [ ] Update all internal imports
- [ ] Update tsconfig paths
- [ ] Update turbo.json

**Phase 2: Directory Rename**
- [ ] Update getConfigDir() → `~/.assistants`
- [ ] Update project config path → `.assistants/`
- [ ] Add migration utility
- [ ] Add backwards-compat symlink

**Phase 3: Binary Rename**
- [ ] Update bin entry in package.json
- [ ] Add `oldpal` as deprecated alias
- [ ] Update shebang/entry point

**Phase 4: Content Updates**
- [ ] Update README.md
- [ ] Update CLAUDE.md / ASSISTANTS.md
- [ ] Update all comments/docs
- [ ] Update error messages
- [ ] Update UI strings (WelcomeBanner, etc.)

**Phase 5: Publishing**
- [ ] Publish @hasna/assistants to npm
- [ ] Deprecate @hasna/oldpal
- [ ] Update GitHub repo name (optional)
- [ ] Update all external references

#### Files to Modify (Partial List)
```
package.json                            # name, bin
packages/*/package.json                 # names
packages/core/src/config.ts             # .oldpal → .assistants
packages/core/src/logger.ts             # paths
packages/terminal/src/index.tsx         # branding
packages/terminal/src/components/*.tsx  # UI strings
README.md
CLAUDE.md → ASSISTANTS.md
```

#### Timeline Consideration

The rename should happen:
1. **After** identity system is designed (to include new paths)
2. **Before** major public release
3. **With** proper migration tooling

---

## Updated Status Tracking

### New Items Added

| # | Item | Priority | Progress | Status |
|---|------|----------|----------|--------|
| 12 | Identity & Multi-Assistant | 🔴 High | ⬜ 0% | Planning |
| 13 | Rename to "assistants" | 🔴 High | ⬜ 0% | Planning |

### Updated Progress Overview

```
HIGH PRIORITY     [████████░░░░░░░░░░░░] 35% (6/17 subtasks)
MEDIUM PRIORITY   [██░░░░░░░░░░░░░░░░░░] 10% (2/20 subtasks)
LOW PRIORITY      [░░░░░░░░░░░░░░░░░░░░]  0% (0/15 subtasks)
MAJOR INITIATIVES [░░░░░░░░░░░░░░░░░░░░]  0% (0/25 subtasks)
─────────────────────────────────────────────────────────
OVERALL           [██░░░░░░░░░░░░░░░░░░]  8% (8/77 subtasks)
```

### Subtask Breakdown (New Items)

#### 12. Identity & Multi-Assistant (0/12)
- [ ] Design identity data models
- [ ] Design assistant data models
- [ ] Implement file-based storage
- [ ] Create identity loader
- [ ] System prompt injection
- [ ] Identity context for tools
- [ ] /assistant commands
- [ ] /identity commands
- [ ] Interactive editor
- [ ] UI: identity in status bar
- [ ] UI: assistant selector
- [ ] Migration from current structure

#### 13. Rename to "assistants" (0/13)
- [ ] Rename workspace packages
- [ ] Update internal imports
- [ ] Update tsconfig paths
- [ ] Update turbo.json
- [ ] Update getConfigDir()
- [ ] Update project config path
- [ ] Add migration utility
- [ ] Add backwards-compat symlink
- [ ] Update bin entry
- [ ] Update README.md
- [ ] Update all UI strings
- [ ] Publish @hasna/assistants
- [ ] Deprecate @hasna/oldpal

---

## Updated Implementation Order

1. **Phase 1**: Security & Stability
   - Input validation
   - Error handling
   - Bash/connector security audit

2. **Phase 2**: Core Infrastructure
   - Heartbeat system
   - Prompt/agent hooks
   - **Identity system (data layer)**

3. **Phase 3**: Major Refactoring
   - **Rename to "assistants"**
   - **Multi-assistant support**
   - Context summarization

4. **Phase 4**: Features
   - Scheduled commands
   - Identity commands & UI

5. **Phase 5**: Quality
   - Test coverage expansion
   - Documentation

6. **Phase 6**: Advanced
   - Stamina/energy system
   - Voice features
   - Web UI

---

## Future Considerations

- **Memory consolidation during sleep**: Agent reviews and summarizes learnings
- **Dream mode**: Background processing of deferred tasks during low-activity periods
- **Mood system**: Agent personality shifts based on stamina/energy
- **Health metrics dashboard**: `/health` command showing stamina, energy, heartbeat, scheduled tasks
- **Plugin system**: Allow third-party tools and skills
- **Multi-agent collaboration**: Multiple assistants working together
- **Identity sharing**: Share identities across assistants
- **Identity templates**: Pre-built identity profiles for common use cases
- **Team identities**: Shared identities for team/organization use

---

## Notes

- All systems should be optional and configurable
- Default behavior should feel natural, not gamified
- Focus on sustainable AI assistance, not constant availability
- Consider user preferences for agent activity patterns
- Security is paramount - never compromise on safety
- Identity data should be encrypted at rest (future)
- Migration must be seamless and reversible

# Plan: Identity & Multi-Assistant System + Rename to "assistants"

**Plan ID:** 00012
**Status:** Completed
**Priority:** Medium
**Estimated Effort:** Large (7+ days)
**Dependencies:** None

---

## Overview

Rename the project from "oldpal" to "assistants" and implement a comprehensive identity system supporting multiple assistants, each with multiple identities. This is a combined effort for cleaner migration.

## User Requirements (Confirmed)

- **Storage**: Consolidated identity.json per identity
- **Structure**: Each assistant has its own identities (1 assistant → many identities)
- **Location**: New ~/.assistants/ global directory
- **Scope**: Implement rename + identity system together

---

## Directory Structure

```
~/.assistants/                          # New global config (renamed from .oldpal)
├── config.json                         # Global settings (was settings.json)
├── hooks.json                          # Global hooks
├── active.json                         # Currently active assistant ID
├── assistants/                         # Multi-assistant storage
│   ├── index.json                      # List of all assistant IDs
│   └── {assistant-id}/
│       ├── config.json                 # Assistant-specific settings
│       ├── identities/
│       │   ├── index.json              # List of identity IDs for this assistant
│       │   ├── {identity-id}.json      # Consolidated identity data
│       │   └── ...
│       ├── sessions/
│       │   └── {session-id}.json
│       └── memory.db                   # Per-assistant SQLite
├── shared/                             # Shared resources across assistants
│   ├── skills/
│   └── connectors/
├── logs/                               # Global logs
│   └── {YYYY-MM-DD}.log
└── migration/
    └── .migrated-from-oldpal           # Migration marker

{project}/.assistants/                  # Project-level (replaces .oldpal)
├── config.json
├── hooks.json
├── skills/
└── schedules/
```

---

## Data Models

### Assistant

```typescript
// packages/core/src/identity/types.ts

interface Assistant {
  id: string;                    // UUID
  name: string;                  // Display name ("Work Assistant", "Personal")
  description?: string;          // What this assistant is for
  avatar?: string;               // Emoji or image path
  defaultIdentityId?: string;    // Primary identity for this assistant
  settings: AssistantSettings;
  createdAt: string;             // ISO timestamp
  updatedAt: string;
}

interface AssistantSettings {
  model: string;                 // "claude-sonnet-4-20250514"
  maxTokens?: number;
  temperature?: number;
  systemPromptAddition?: string; // Added to base system prompt
  enabledTools?: string[];       // Tool whitelist (null = all)
  disabledTools?: string[];      // Tool blacklist
  skillDirectories?: string[];   // Additional skill paths
}
```

### Identity

```typescript
interface Identity {
  id: string;                    // UUID
  name: string;                  // "Work", "Personal", "Client A"
  isDefault: boolean;
  profile: IdentityProfile;
  contacts: IdentityContacts;
  preferences: IdentityPreferences;
  context?: string;              // Custom system prompt addition
  createdAt: string;
  updatedAt: string;
}

interface IdentityProfile {
  displayName: string;           // "John Smith"
  title?: string;                // "Software Engineer"
  company?: string;
  bio?: string;
  timezone: string;              // "America/New_York"
  locale: string;                // "en-US"
}

interface IdentityContacts {
  emails: ContactEntry[];        // [{value, label, isPrimary}]
  phones: ContactEntry[];
  addresses: AddressEntry[];
  social?: SocialEntry[];        // GitHub, Twitter, etc.
}

interface ContactEntry {
  value: string;
  label: string;                 // "work", "personal", "primary"
  isPrimary?: boolean;
}

interface AddressEntry {
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  label: string;
}

interface IdentityPreferences {
  language: string;              // "en"
  dateFormat: string;            // "YYYY-MM-DD"
  communicationStyle: 'formal' | 'casual' | 'professional';
  responseLength: 'concise' | 'detailed' | 'balanced';
  codeStyle?: {
    indentation: 'tabs' | 'spaces';
    indentSize: number;
    quoteStyle: 'single' | 'double';
  };
  custom: Record<string, unknown>;
}
```

---

## Core Implementation

### AssistantManager

```typescript
// packages/core/src/identity/assistant-manager.ts

class AssistantManager {
  private basePath: string = expandPath('~/.assistants');
  private assistants: Map<string, Assistant>;
  private activeId: string | null;

  // Lifecycle
  async initialize(): Promise<void>

  // CRUD
  async createAssistant(options: CreateAssistantOptions): Promise<Assistant>
  async updateAssistant(id: string, updates: Partial<Assistant>): Promise<Assistant>
  async deleteAssistant(id: string): Promise<void>

  // Selection
  async switchAssistant(id: string): Promise<Assistant>
  getActive(): Assistant | null
  listAssistants(): Assistant[]

  // Identity delegation
  getIdentityManager(assistantId: string): IdentityManager
}
```

### IdentityManager

```typescript
// packages/core/src/identity/identity-manager.ts

class IdentityManager {
  private assistantPath: string;
  private identities: Map<string, Identity>;

  constructor(assistantId: string, basePath: string)

  // CRUD
  async createIdentity(options: CreateIdentityOptions): Promise<Identity>
  async updateIdentity(id: string, updates: Partial<Identity>): Promise<Identity>
  async deleteIdentity(id: string): Promise<void>

  // Selection
  async switchIdentity(id: string): Promise<Identity>
  getActive(): Identity | null
  listIdentities(): Identity[]

  // Context building
  buildSystemPromptContext(): string  // Returns identity info for LLM
}
```

### Migration System

```typescript
// packages/core/src/migration/migrate-to-assistants.ts

interface MigrationResult {
  success: boolean;
  migrated: string[];
  errors: string[];
  backupPath?: string;
}

async function migrateFromOldpal(): Promise<MigrationResult> {
  // 1. Check if ~/.oldpal exists
  // 2. Check if ~/.assistants already exists (abort if so)
  // 3. Create ~/.assistants structure
  // 4. Copy config: settings.json → config.json
  // 5. Copy hooks.json, skills/, sessions/, logs/
  // 6. Create default assistant from old config
  // 7. Create default identity with empty contacts
  // 8. Rename ~/.oldpal → ~/.oldpal.backup
  // 9. Create migration marker
}
```

---

## Commands

### /assistant

```
/assistant                     # Show current assistant info
/assistant list                # List all assistants
/assistant create <name>       # Create new assistant
/assistant switch <name|id>    # Switch to assistant
/assistant delete <name|id>    # Delete assistant
/assistant settings            # Show/edit settings
```

### /identity

```
/identity                      # Show current identity
/identity list                 # List identities for current assistant
/identity create <name>        # Create new identity
/identity switch <name|id>     # Switch identity
/identity edit                 # Interactive identity editor
/identity delete <name|id>     # Delete identity
```

### /whoami

```
/whoami                        # Quick display of current assistant + identity
```

---

## Implementation Steps

### Step 1: Core Types & Managers
- [x] Create `packages/core/src/identity/types.ts`
- [x] Create `packages/core/src/identity/assistant-manager.ts`
- [x] Create `packages/core/src/identity/identity-manager.ts`
- [x] Create `packages/core/src/identity/index.ts`
- [x] Add types to `packages/shared/src/types.ts`

### Step 2: Migration System
- [x] Create `packages/core/src/migration/index.ts`
- [x] Create `packages/core/src/migration/migrate-to-assistants.ts`
- [x] Create `packages/core/src/migration/validators.ts`

### Step 3: Integration
- [x] Modify `packages/core/src/config.ts` - update paths
- [x] Modify `packages/core/src/agent/loop.ts` - inject identity
- [x] Modify `packages/core/src/client.ts` - use AssistantManager
- [x] Modify `packages/core/src/index.ts` - export modules

### Step 4: Commands
- [x] Add /assistant command to `builtin.ts`
- [x] Add /identity command to `builtin.ts`
- [x] Add /whoami command to `builtin.ts`

### Step 5: Package Rename
- [x] Update `package.json` - name: @hasna/assistants
- [x] Update all `packages/*/package.json`
- [x] Replace "oldpal" → "assistants" in all source files
- [x] Update `README.md`

### Step 6: Terminal UI
- [x] Modify `Status.tsx` - show assistant/identity
- [x] Modify `index.tsx` - run migration on startup

---

## Identity Context Injection

The active identity is injected into the system prompt:

```typescript
// In AgentLoop.buildSystemPrompt()

const identityContext = this.identityManager?.buildSystemPromptContext();
if (identityContext) {
  systemPrompt += `\n\n## Your Identity\n${identityContext}`;
}
```

Example output:
```
## Your Identity
You are operating as "Work Assistant" with the "Work" identity.
- Name: John Smith
- Email: john@company.com (primary)
- Timezone: America/New_York
- Communication style: professional
```

---

## Verification Steps

1. **Fresh install**: `npm install -g assistants` → creates ~/.assistants
2. **Migration**: Run with existing ~/.oldpal → migrates to ~/.assistants
3. **Create assistant**: `/assistant create "Work"` → creates assistant
4. **Create identity**: `/identity create "Office"` → creates identity
5. **Switch**: `/assistant switch Work` → changes active assistant
6. **Whoami**: `/whoami` → shows current assistant/identity
7. **Context**: Ask "what's my email?" → LLM knows from identity

---

## Risk Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss during migration | High | Create ~/.oldpal.backup before migration |
| Breaking existing users | High | Deprecation package with clear message |
| npm name conflicts | Medium | Use @hasna/assistants scoped name |
| Complex multi-file rename | Medium | Automated search/replace with tests |

---

## Approval

- [x] User requirements confirmed
- [x] Technical design approved
- [x] Implementation steps clear
- [x] Ready to implement

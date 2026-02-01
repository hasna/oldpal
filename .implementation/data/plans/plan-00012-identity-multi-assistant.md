# Plan: Identity & Multi-Assistant System

**Plan ID:** 00012
**Status:** Draft
**Priority:** Medium
**Estimated Effort:** Large (7+ days)
**Dependencies:** None

---

## Overview

Implement an identity system that stores assistant metadata (email, phone, preferences) and supports multiple assistants with different configurations. Each assistant can have multiple identities for different contexts (work, personal, etc.).

## Current State

- Single anonymous assistant
- No identity storage
- No multi-assistant support
- Settings are global

## Requirements

### Functional
1. Store assistant identities (email, phone, address, preferences)
2. Support multiple assistants with unique configurations
3. Support multiple identities per assistant (contexts)
4. Identity-aware responses (assistant knows who it is)
5. Switch between assistants easily

### Non-Functional
1. Secure storage for sensitive identity data
2. Fast assistant switching
3. Backward compatible with single-assistant use
4. Extensible identity schema

## Technical Design

### Data Model

```typescript
// packages/core/src/identity/types.ts

interface Assistant {
  id: string;              // UUID
  name: string;            // Display name
  avatar?: string;         // URL or local path
  defaultIdentity: string; // Default identity ID
  identities: Identity[];
  settings: AssistantSettings;
  createdAt: string;
  updatedAt: string;
}

interface Identity {
  id: string;
  name: string;           // e.g., "Work", "Personal"
  isDefault: boolean;
  contact: ContactInfo;
  preferences: Preferences;
  context?: string;       // System prompt addition
}

interface ContactInfo {
  emails: EmailIdentity[];
  phones: PhoneIdentity[];
  addresses: AddressIdentity[];
  social?: SocialIdentity[];
}

interface EmailIdentity {
  email: string;
  label: string;          // "primary", "work", "personal"
  verified?: boolean;
}

interface PhoneIdentity {
  number: string;
  label: string;
  type: 'mobile' | 'work' | 'home';
}

interface AddressIdentity {
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  label: string;
}

interface SocialIdentity {
  platform: string;       // "github", "twitter", etc.
  username: string;
  url?: string;
}

interface Preferences {
  language: string;
  timezone: string;
  dateFormat: string;
  communicationStyle?: 'formal' | 'casual' | 'professional';
  codeStyle?: {
    indentation: 'tabs' | 'spaces';
    indentSize: number;
    quoteStyle: 'single' | 'double';
  };
  responseLength?: 'concise' | 'detailed' | 'balanced';
  customPreferences: Record<string, any>;
}

interface AssistantSettings {
  model: string;
  temperature: number;
  maxTokens?: number;
  tools: {
    enabled: string[];
    disabled: string[];
  };
  hooks?: string;         // Path to hooks.json
  skills?: string[];      // Skill directories
}
```

### Storage Structure

```
~/.assistants/
├── assistants.json       # List of assistants
├── active.json           # Currently active assistant
└── {assistant-id}/
    ├── config.json       # Assistant settings
    ├── identities/
    │   ├── {identity-id}.json
    │   └── ...
    ├── sessions/         # Session history
    └── memory.db         # SQLite database
```

### Assistant Manager

```typescript
// packages/core/src/identity/manager.ts

class AssistantManager {
  private basePath: string;
  private assistants: Map<string, Assistant> = new Map();
  private activeId: string | null = null;

  constructor(basePath: string = '~/.assistants') {
    this.basePath = expandPath(basePath);
  }

  async initialize(): Promise<void> {
    await this.ensureDirectories();
    await this.loadAssistants();
    await this.loadActive();
  }

  async createAssistant(options: CreateAssistantOptions): Promise<Assistant> {
    const id = generateUUID();
    const now = new Date().toISOString();

    const assistant: Assistant = {
      id,
      name: options.name,
      avatar: options.avatar,
      defaultIdentity: '',
      identities: [],
      settings: {
        model: options.model || 'claude-sonnet-4-20250514',
        temperature: options.temperature || 0.7,
        tools: { enabled: [], disabled: [] },
      },
      createdAt: now,
      updatedAt: now,
    };

    // Create default identity
    const defaultIdentity = await this.createIdentity(id, {
      name: 'Default',
      isDefault: true,
      contact: { emails: [], phones: [], addresses: [] },
      preferences: {
        language: 'en',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        dateFormat: 'YYYY-MM-DD',
        customPreferences: {},
      },
    });

    assistant.defaultIdentity = defaultIdentity.id;
    assistant.identities.push(defaultIdentity);

    // Save
    await this.saveAssistant(assistant);
    this.assistants.set(id, assistant);

    return assistant;
  }

  async switchAssistant(id: string): Promise<Assistant> {
    const assistant = this.assistants.get(id);
    if (!assistant) {
      throw new Error(`Assistant not found: ${id}`);
    }

    this.activeId = id;
    await this.saveActive();

    return assistant;
  }

  getActive(): Assistant | null {
    return this.activeId ? this.assistants.get(this.activeId) || null : null;
  }

  listAssistants(): Assistant[] {
    return Array.from(this.assistants.values());
  }

  async createIdentity(
    assistantId: string,
    options: CreateIdentityOptions
  ): Promise<Identity> {
    const identity: Identity = {
      id: generateUUID(),
      name: options.name,
      isDefault: options.isDefault || false,
      contact: options.contact,
      preferences: options.preferences,
      context: options.context,
    };

    const identityPath = join(
      this.basePath,
      assistantId,
      'identities',
      `${identity.id}.json`
    );
    await writeFile(identityPath, JSON.stringify(identity, null, 2));

    return identity;
  }

  async updateIdentity(
    assistantId: string,
    identityId: string,
    updates: Partial<Identity>
  ): Promise<Identity> {
    const assistant = this.assistants.get(assistantId);
    if (!assistant) throw new Error('Assistant not found');

    const identity = assistant.identities.find(i => i.id === identityId);
    if (!identity) throw new Error('Identity not found');

    Object.assign(identity, updates);

    const identityPath = join(
      this.basePath,
      assistantId,
      'identities',
      `${identityId}.json`
    );
    await writeFile(identityPath, JSON.stringify(identity, null, 2));

    return identity;
  }

  getActiveIdentity(): Identity | null {
    const assistant = this.getActive();
    if (!assistant) return null;

    return assistant.identities.find(i => i.id === assistant.defaultIdentity) ||
           assistant.identities.find(i => i.isDefault) ||
           assistant.identities[0] || null;
  }

  buildIdentityContext(identity: Identity): string {
    const lines: string[] = [];

    if (identity.contact.emails.length > 0) {
      const primary = identity.contact.emails.find(e => e.label === 'primary') ||
                     identity.contact.emails[0];
      lines.push(`Your email address is ${primary.email}.`);
    }

    if (identity.contact.phones.length > 0) {
      const primary = identity.contact.phones[0];
      lines.push(`Your phone number is ${primary.number}.`);
    }

    if (identity.contact.addresses.length > 0) {
      const addr = identity.contact.addresses[0];
      lines.push(`Your address is ${addr.street}, ${addr.city}, ${addr.country}.`);
    }

    if (identity.preferences.timezone) {
      lines.push(`You operate in the ${identity.preferences.timezone} timezone.`);
    }

    if (identity.context) {
      lines.push(identity.context);
    }

    return lines.join(' ');
  }

  private async ensureDirectories(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
  }

  private async loadAssistants(): Promise<void> {
    const listPath = join(this.basePath, 'assistants.json');
    try {
      const content = await readFile(listPath, 'utf-8');
      const list = JSON.parse(content) as { assistants: string[] };

      for (const id of list.assistants) {
        const assistant = await this.loadAssistant(id);
        if (assistant) {
          this.assistants.set(id, assistant);
        }
      }
    } catch {
      // No assistants yet
    }
  }

  private async loadAssistant(id: string): Promise<Assistant | null> {
    const configPath = join(this.basePath, id, 'config.json');
    try {
      const content = await readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async saveAssistant(assistant: Assistant): Promise<void> {
    const dir = join(this.basePath, assistant.id);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'identities'), { recursive: true });
    await mkdir(join(dir, 'sessions'), { recursive: true });

    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify(assistant, null, 2));

    // Update list
    const listPath = join(this.basePath, 'assistants.json');
    const list = { assistants: Array.from(this.assistants.keys()) };
    if (!list.assistants.includes(assistant.id)) {
      list.assistants.push(assistant.id);
    }
    await writeFile(listPath, JSON.stringify(list, null, 2));
  }

  private async loadActive(): Promise<void> {
    const activePath = join(this.basePath, 'active.json');
    try {
      const content = await readFile(activePath, 'utf-8');
      const { activeId } = JSON.parse(content);
      if (this.assistants.has(activeId)) {
        this.activeId = activeId;
      }
    } catch {
      // No active assistant
    }
  }

  private async saveActive(): Promise<void> {
    const activePath = join(this.basePath, 'active.json');
    await writeFile(activePath, JSON.stringify({ activeId: this.activeId }));
  }
}
```

### Commands

```typescript
// Add to packages/core/src/commands/builtin.ts

const assistantCommands = {
  '/assistant': {
    description: 'Manage assistants',
    usage: '/assistant [list|create|switch|delete] [args]',
    execute: async (args, context) => {
      const [action, ...rest] = args.split(' ');
      const manager = context.assistantManager;

      switch (action) {
        case 'list':
          const assistants = manager.listAssistants();
          const active = manager.getActive();
          return assistants.map(a =>
            `${a.id === active?.id ? '*' : ' '} ${a.name} (${a.id.slice(0, 8)})`
          ).join('\n') || 'No assistants. Use /assistant create <name>';

        case 'create':
          const name = rest.join(' ') || 'New Assistant';
          const assistant = await manager.createAssistant({ name });
          await manager.switchAssistant(assistant.id);
          return `Created and switched to: ${assistant.name}`;

        case 'switch':
          const target = rest[0];
          const found = manager.listAssistants().find(
            a => a.id.startsWith(target) || a.name.toLowerCase() === target.toLowerCase()
          );
          if (!found) return `Assistant not found: ${target}`;
          await manager.switchAssistant(found.id);
          return `Switched to: ${found.name}`;

        case 'delete':
          // Implementation...
          break;

        default:
          const current = manager.getActive();
          return current
            ? `Current assistant: ${current.name}\nUse /assistant list to see all.`
            : 'No active assistant. Use /assistant create <name>';
      }
    },
  },

  '/identity': {
    description: 'Manage identities',
    usage: '/identity [list|add|edit|switch] [args]',
    execute: async (args, context) => {
      // Implementation for identity management
    },
  },

  '/whoami': {
    description: 'Show current identity',
    execute: async (args, context) => {
      const manager = context.assistantManager;
      const assistant = manager.getActive();
      const identity = manager.getActiveIdentity();

      if (!assistant || !identity) {
        return 'No active assistant/identity.';
      }

      const lines = [
        `Assistant: ${assistant.name}`,
        `Identity: ${identity.name}`,
      ];

      if (identity.contact.emails.length > 0) {
        lines.push(`Email: ${identity.contact.emails[0].email}`);
      }
      if (identity.contact.phones.length > 0) {
        lines.push(`Phone: ${identity.contact.phones[0].number}`);
      }

      return lines.join('\n');
    },
  },
};
```

## Implementation Steps

### Step 1: Create Identity Types
- [ ] Define Assistant interface
- [ ] Define Identity interface
- [ ] Define ContactInfo interfaces
- [ ] Define Preferences interface

**Files:**
- `packages/core/src/identity/types.ts`

### Step 2: Implement Storage Layer
- [ ] Create directory structure helpers
- [ ] Implement file-based storage
- [ ] Add migration support

**Files:**
- `packages/core/src/identity/storage.ts`

### Step 3: Implement AssistantManager
- [ ] Create AssistantManager class
- [ ] Add assistant CRUD
- [ ] Add identity CRUD
- [ ] Add switching logic

**Files:**
- `packages/core/src/identity/manager.ts`

### Step 4: Add Commands
- [ ] Implement /assistant command
- [ ] Implement /identity command
- [ ] Implement /whoami command

**Files:**
- `packages/core/src/commands/builtin.ts`

### Step 5: Integrate with Agent
- [ ] Pass identity context to system prompt
- [ ] Load assistant settings on startup
- [ ] Handle assistant switching

**Files:**
- `packages/core/src/agent/loop.ts`
- `packages/core/src/client.ts`

### Step 6: Add UI Elements
- [ ] Show current assistant in status
- [ ] Add assistant selector
- [ ] Show identity info

**Files:**
- `packages/terminal/src/components/Status.tsx`
- `packages/terminal/src/components/AssistantSelector.tsx`

### Step 7: Add Tests
- [ ] Test assistant CRUD
- [ ] Test identity CRUD
- [ ] Test switching
- [ ] Test context building

**Files:**
- `packages/core/tests/identity.test.ts`

## Testing Strategy

```typescript
describe('AssistantManager', () => {
  it('should create assistant with default identity');
  it('should switch between assistants');
  it('should list all assistants');
  it('should persist to disk');
});

describe('Identity', () => {
  it('should create identities');
  it('should build context from identity');
  it('should switch identities');
});
```

## Rollout Plan

1. Create identity types
2. Implement storage layer
3. Build AssistantManager
4. Add commands
5. Integrate with agent
6. Add UI elements
7. Test and document

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sensitive data exposure | High | Encrypt sensitive fields |
| Migration complexity | Medium | Version schema, migration scripts |
| Breaking single-user flow | Medium | Default assistant auto-created |

---

## Approval

- [ ] Technical design approved
- [ ] Implementation steps clear
- [ ] Tests defined
- [ ] Ready to implement

# Plan: Rename from "oldpal" to "assistants"

**Plan ID:** 00013
**Status:** MERGED INTO plan-00012
**Priority:** Medium
**Estimated Effort:** Medium (2-3 days)
**Dependencies:** plan-00012 (Identity & Multi-Assistant System)

> **Note:** This plan has been merged with plan-00012 (Identity & Multi-Assistant System).
> The rename will be implemented together with the identity system for a cleaner migration.
> See plan-00012 for the combined implementation details.

---

## Overview

Rename the project from "oldpal" to "assistants" to better reflect its purpose as a multi-assistant management platform. This involves updating package names, CLI commands, configuration directories, and all references.

## Current State

- Package name: `oldpal`
- CLI command: `oldpal`
- Config directory: `~/.oldpal/`
- NPM package: `oldpal`
- Repository: `opensource-oldpal`

## Requirements

### Functional
1. New CLI command: `assistants` (with `ast` alias)
2. New config directory: `~/.assistants/`
3. Migrate existing configs automatically
4. Update all package names
5. Publish to npm under new name

### Non-Functional
1. Zero data loss during migration
2. Clear deprecation path for old package
3. Backward compatibility period
4. Minimal user disruption

## Technical Design

### Naming Changes

| Current | New |
|---------|-----|
| `oldpal` (package) | `@hasnaxyz/assistants` |
| `oldpal` (CLI) | `assistants`, `ast` |
| `~/.oldpal/` | `~/.assistants/` |
| `oldpal` (npm) | `assistants` |
| `connect-oldpal` | `connect-assistants` |

### Migration Script

```typescript
// packages/core/src/migration/v1-rename.ts

interface MigrationResult {
  success: boolean;
  migrated: string[];
  errors: string[];
}

async function migrateFromOldpal(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    migrated: [],
    errors: [],
  };

  const oldPath = expandPath('~/.oldpal');
  const newPath = expandPath('~/.assistants');

  // Check if migration needed
  if (!existsSync(oldPath)) {
    result.success = true;
    return result;
  }

  if (existsSync(newPath)) {
    // Both exist - check if already migrated
    const marker = join(newPath, '.migrated-from-oldpal');
    if (existsSync(marker)) {
      result.success = true;
      return result;
    }
    result.errors.push('Both ~/.oldpal and ~/.assistants exist. Manual merge required.');
    return result;
  }

  try {
    // Copy directory structure
    await copyDir(oldPath, newPath);
    result.migrated.push('Configuration directory');

    // Update internal references
    await updateConfigReferences(newPath);
    result.migrated.push('Configuration files');

    // Create migration marker
    await writeFile(
      join(newPath, '.migrated-from-oldpal'),
      JSON.stringify({
        migratedAt: new Date().toISOString(),
        fromVersion: 'oldpal',
        toVersion: 'assistants',
      })
    );

    // Rename old directory as backup
    await rename(oldPath, `${oldPath}.backup`);
    result.migrated.push('Created backup at ~/.oldpal.backup');

    result.success = true;
  } catch (error) {
    result.errors.push(`Migration failed: ${error}`);
  }

  return result;
}

async function updateConfigReferences(basePath: string): Promise<void> {
  // Update settings.json
  const settingsPath = join(basePath, 'settings.json');
  if (existsSync(settingsPath)) {
    let content = await readFile(settingsPath, 'utf-8');
    content = content.replace(/oldpal/g, 'assistants');
    content = content.replace(/\.oldpal/g, '.assistants');
    await writeFile(settingsPath, content);
  }

  // Update hooks.json
  const hooksPath = join(basePath, 'hooks.json');
  if (existsSync(hooksPath)) {
    let content = await readFile(hooksPath, 'utf-8');
    content = content.replace(/oldpal/g, 'assistants');
    await writeFile(hooksPath, content);
  }
}
```

### Package.json Changes

```json
// packages/core/package.json
{
  "name": "@hasnaxyz/assistants-core",
  "version": "1.0.0",
  "description": "Core runtime for the assistants CLI"
}

// packages/terminal/package.json
{
  "name": "assistants",
  "version": "1.0.0",
  "description": "AI assistant that runs in the terminal",
  "bin": {
    "assistants": "./dist/index.js",
    "ast": "./dist/index.js"
  }
}

// packages/shared/package.json
{
  "name": "@hasnaxyz/assistants-shared",
  "version": "1.0.0"
}
```

### CLI Entry Point

```typescript
// packages/terminal/src/index.tsx

#!/usr/bin/env bun

import { runMigration } from '@hasnaxyz/assistants-core/migration';

async function main() {
  // Check for migration on first run
  const migrationResult = await runMigration();
  if (migrationResult.migrated.length > 0) {
    console.log('Migrated from oldpal to assistants:');
    migrationResult.migrated.forEach(m => console.log(`  ✓ ${m}`));
    console.log('');
  }

  // Continue with normal startup...
}
```

### Deprecation Notice

```typescript
// Create oldpal-deprecated package that redirects

// packages/oldpal-deprecated/src/index.ts
#!/usr/bin/env node

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   oldpal has been renamed to 'assistants'                  ║
║                                                            ║
║   To install the new version:                              ║
║   npm install -g assistants                                ║
║   # or                                                     ║
║   bun install -g assistants                                ║
║                                                            ║
║   Then run: assistants (or 'ast' for short)                ║
║                                                            ║
║   Your configuration will be automatically migrated.       ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

process.exit(0);
```

### Files to Update

```typescript
// Complete list of files requiring updates

const FILES_TO_UPDATE = [
  // Package files
  'package.json',
  'packages/core/package.json',
  'packages/terminal/package.json',
  'packages/shared/package.json',
  'packages/web/package.json',

  // Source files with "oldpal" references
  'packages/core/src/config.ts',
  'packages/core/src/client.ts',
  'packages/core/src/commands/builtin.ts',
  'packages/terminal/src/index.tsx',
  'packages/terminal/src/components/App.tsx',
  'packages/terminal/src/components/Status.tsx',

  // Documentation
  'README.md',
  'CLAUDE.md',
  'docs/*.md',

  // Configuration examples
  'config/settings.json',
  'config/hooks.json',
];

const SEARCH_REPLACE = [
  { search: 'oldpal', replace: 'assistants' },
  { search: 'Oldpal', replace: 'Assistants' },
  { search: 'OLDPAL', replace: 'ASSISTANTS' },
  { search: '.oldpal', replace: '.assistants' },
];
```

## Implementation Steps

### Step 1: Create Migration Infrastructure
- [ ] Create migration module
- [ ] Implement directory migration
- [ ] Implement config update
- [ ] Add migration marker

**Files:**
- `packages/core/src/migration/index.ts`
- `packages/core/src/migration/v1-rename.ts`

### Step 2: Update Package Names
- [ ] Update all package.json files
- [ ] Update package references
- [ ] Update bin entries
- [ ] Update dependencies

**Files:**
- All package.json files

### Step 3: Update Source References
- [ ] Search and replace in source files
- [ ] Update import paths
- [ ] Update config paths
- [ ] Update CLI name displays

**Files:**
- All source files with "oldpal" references

### Step 4: Update Documentation
- [ ] Update README.md
- [ ] Update CLAUDE.md
- [ ] Update all docs
- [ ] Update examples

**Files:**
- All documentation files

### Step 5: Create Deprecation Package
- [ ] Create oldpal-deprecated package
- [ ] Add redirect message
- [ ] Publish to npm

**Files:**
- `packages/oldpal-deprecated/package.json`
- `packages/oldpal-deprecated/src/index.ts`

### Step 6: Update Repository
- [ ] Rename GitHub repository
- [ ] Update GitHub references
- [ ] Update CI/CD

**Files:**
- `.github/workflows/*`
- Repository settings

### Step 7: Publish
- [ ] Publish new packages to npm
- [ ] Publish deprecation notice package
- [ ] Update npm readme

**Files:**
- npm configuration

### Step 8: Test Migration
- [ ] Test fresh install
- [ ] Test migration from oldpal
- [ ] Test config preservation

**Files:**
- Test files

## Testing Strategy

```typescript
describe('Migration', () => {
  it('should migrate ~/.oldpal to ~/.assistants');
  it('should update config references');
  it('should create backup');
  it('should not overwrite existing ~/.assistants');
  it('should handle missing ~/.oldpal gracefully');
});

describe('CLI', () => {
  it('should respond to "assistants" command');
  it('should respond to "ast" command');
  it('should show correct version and name');
});
```

## Rollout Plan

1. **Phase 1: Preparation**
   - Create migration code
   - Update all references
   - Test thoroughly

2. **Phase 2: Soft Launch**
   - Publish `assistants` package
   - Update `oldpal` to show deprecation
   - Monitor for issues

3. **Phase 3: Full Migration**
   - Rename repository
   - Update all documentation
   - Announce rename

4. **Phase 4: Cleanup**
   - Remove old package after grace period
   - Archive old repository
   - Update any remaining references

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss during migration | Critical | Backup before migration |
| Breaking existing users | High | Long deprecation period, clear messaging |
| npm name conflicts | Medium | Check availability first |
| Broken links | Low | Redirects, search-replace |

---

## Approval

- [ ] Technical design approved
- [ ] Implementation steps clear
- [ ] Tests defined
- [ ] Ready to implement

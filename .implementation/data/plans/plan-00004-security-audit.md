# Plan: Security Audit & Hardening

**Plan ID:** 00004
**Status:** Completed
**Priority:** High
**Estimated Effort:** Medium (3 days)
**Dependencies:** plan-00003 (Input Validation)

---

## Overview

Conduct comprehensive security audit of all tool execution paths, file operations, and bash command handling to identify and fix potential vulnerabilities.

## Current State

- Bash tool has basic command allowlist
- File operations have some path validation
- No systematic security review completed
- Potential command injection vectors
- Symlink attacks possible
- No audit logging

## Requirements

### Functional
1. Audit all tool execution for injection vulnerabilities
2. Harden file path handling against traversal and symlinks
3. Review bash command sanitization
4. Implement security event logging

### Non-Functional
1. No performance regression from security measures
2. Security controls should be transparent to users
3. Clear error messages for blocked operations

## Technical Design

### Security Audit Checklist

```typescript
// packages/core/src/security/audit.ts

interface SecurityAudit {
  toolName: string;
  vulnerabilities: Vulnerability[];
  mitigations: Mitigation[];
  status: 'pending' | 'reviewed' | 'hardened';
}

interface Vulnerability {
  type: 'command_injection' | 'path_traversal' | 'symlink_attack' | 'information_disclosure';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  location: string;
  cwe?: string; // CWE reference
}

interface Mitigation {
  vulnerability: string;
  fix: string;
  implemented: boolean;
}
```

### Bash Command Hardening

```typescript
// packages/core/src/tools/bash-security.ts

const DANGEROUS_PATTERNS = [
  /;\s*rm\s+-rf/i,           // Chained rm -rf
  /\$\([^)]*\)/,             // Command substitution
  /`[^`]*`/,                 // Backtick substitution
  />\s*\/dev\/sd[a-z]/i,     // Write to disk device
  /\|\s*(bash|sh|zsh)/i,     // Pipe to shell
  /eval\s+/i,                // eval command
  /&&\s*sudo/i,              // Chained sudo
];

const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=/dev/zero',
  ':(){:|:&};:',  // Fork bomb
];

function validateBashCommand(command: string): ValidationResult {
  // Check against blocked commands
  for (const blocked of BLOCKED_COMMANDS) {
    if (command.includes(blocked)) {
      return {
        valid: false,
        reason: `Blocked command pattern: ${blocked}`,
        severity: 'critical',
      };
    }
  }

  // Check against dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        valid: false,
        reason: `Dangerous pattern detected: ${pattern}`,
        severity: 'high',
      };
    }
  }

  return { valid: true };
}
```

### File Path Hardening

```typescript
// packages/core/src/security/paths.ts

const PROTECTED_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '~/.ssh',
  '~/.gnupg',
  '~/.aws/credentials',
  '~/.kube/config',
];

async function isPathSafe(
  targetPath: string,
  operation: 'read' | 'write' | 'delete'
): Promise<{ safe: boolean; reason?: string }> {
  const resolved = await resolvePath(targetPath);

  // Check protected paths
  for (const protected of PROTECTED_PATHS) {
    const expandedProtected = protected.replace('~', os.homedir());
    if (resolved.startsWith(expandedProtected)) {
      if (operation === 'write' || operation === 'delete') {
        return {
          safe: false,
          reason: `Cannot ${operation} protected path: ${protected}`,
        };
      }
    }
  }

  // Check symlink targets
  const stat = await lstat(resolved).catch(() => null);
  if (stat?.isSymbolicLink()) {
    const target = await realpath(resolved);
    if (!isWithinWorkingDirectory(target)) {
      return {
        safe: false,
        reason: 'Symlink points outside working directory',
      };
    }
  }

  return { safe: true };
}
```

### Security Event Logging

```typescript
// packages/core/src/security/logger.ts

interface SecurityEvent {
  timestamp: string;
  eventType: 'blocked_command' | 'path_violation' | 'validation_failure';
  severity: 'critical' | 'high' | 'medium' | 'low';
  details: {
    tool?: string;
    command?: string;
    path?: string;
    reason: string;
  };
  sessionId: string;
}

class SecurityLogger {
  private events: SecurityEvent[] = [];
  private logFile?: string;

  log(event: Omit<SecurityEvent, 'timestamp'>): void {
    const fullEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.events.push(fullEvent);

    if (event.severity === 'critical' || event.severity === 'high') {
      console.warn(`[SECURITY] ${event.eventType}: ${event.details.reason}`);
    }

    this.persist(fullEvent);
  }

  getEvents(filter?: Partial<SecurityEvent>): SecurityEvent[] {
    return this.events.filter(e => {
      if (filter?.eventType && e.eventType !== filter.eventType) return false;
      if (filter?.severity && e.severity !== filter.severity) return false;
      return true;
    });
  }

  private async persist(event: SecurityEvent): Promise<void> {
    if (this.logFile) {
      await appendFile(this.logFile, JSON.stringify(event) + '\n');
    }
  }
}
```

## Implementation Steps

### Step 1: Create Security Module Structure
- [ ] Create `packages/core/src/security/` directory
- [ ] Add index.ts with exports
- [ ] Define security types and interfaces

**Files:**
- `packages/core/src/security/index.ts`
- `packages/core/src/security/types.ts`

### Step 2: Audit Bash Tool
- [ ] Review current bash command handling
- [ ] Document all injection vectors
- [ ] Implement command validation
- [ ] Add dangerous pattern detection
- [ ] Block known dangerous commands

**Files:**
- `packages/core/src/tools/bash.ts`
- `packages/core/src/security/bash-validator.ts`

### Step 3: Audit File Operations
- [ ] Review read/write/edit tools
- [ ] Document path traversal vectors
- [ ] Implement path hardening
- [ ] Add symlink validation
- [ ] Protect sensitive paths

**Files:**
- `packages/core/src/tools/filesystem.ts`
- `packages/core/src/security/path-validator.ts`

### Step 4: Implement Security Logger
- [ ] Create security event logger
- [ ] Add event persistence
- [ ] Integrate with tools
- [ ] Add /security-log command

**Files:**
- `packages/core/src/security/logger.ts`
- `packages/core/src/commands/builtin.ts`

### Step 5: Add Security Tests
- [ ] Test bash command validation
- [ ] Test path traversal prevention
- [ ] Test symlink handling
- [ ] Test protected path blocking

**Files:**
- `packages/core/tests/security.test.ts`

### Step 6: Document Security Model
- [ ] Document threat model
- [ ] List mitigations
- [ ] Create security guidelines
- [ ] Add to README

**Files:**
- `docs/security.md`

## Testing Strategy

```typescript
describe('Bash Security', () => {
  it('should block rm -rf /');
  it('should detect command substitution');
  it('should block fork bombs');
  it('should allow safe commands');
});

describe('Path Security', () => {
  it('should prevent path traversal');
  it('should resolve symlinks');
  it('should block protected paths for writes');
  it('should allow reading non-sensitive files');
});

describe('Security Logger', () => {
  it('should log blocked operations');
  it('should persist critical events');
  it('should filter events by type');
});
```

## Rollout Plan

1. Create security module structure
2. Audit and harden bash tool
3. Audit and harden file operations
4. Implement security logging
5. Add comprehensive tests
6. Document security model

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| False positives blocking valid commands | Medium | Comprehensive testing, allowlist overrides |
| Performance impact from validation | Low | Efficient regex, caching |
| Breaking existing workflows | Medium | Gradual rollout, user notification |

---

## Approval

- [ ] Technical design approved
- [ ] Implementation steps clear
- [ ] Tests defined
- [ ] Ready to implement

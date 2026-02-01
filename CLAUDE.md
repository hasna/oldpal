# assistants - Development Guide

## Project Overview

assistants is a personal AI assistant that runs in the terminal, uses existing `connect-*` CLI connectors, and supports skills and hooks similar to Claude Code.

## Tech Stack

- **Runtime**: Bun
- **Package Manager**: pnpm with workspaces
- **Monorepo**: Turborepo
- **Terminal UI**: Ink (React for terminals)
- **LLM**: Claude API (Anthropic SDK)
- **Database**: SQLite (bun:sqlite)

## Project Structure

```
packages/
├── core/           # Platform-agnostic agent runtime
│   ├── agent/      # Agent loop and context management
│   ├── tools/      # Tool registry and built-in tools
│   ├── skills/     # Skill loading and execution
│   ├── hooks/      # Hook loading and execution
│   ├── memory/     # SQLite persistence
│   └── llm/        # LLM client abstraction
├── terminal/       # Ink-based terminal UI
│   └── components/ # React components for terminal
├── shared/         # Shared types and utilities
└── web/            # Future web UI (React)
```

## Key Patterns

### Connector Bridge

Connectors are your existing `connect-*` CLIs wrapped as tools:

```typescript
// The bridge discovers CLIs and creates tool definitions
const bridge = new ConnectorBridge();
await bridge.discover(['notion', 'googledrive', 'gmail']);
bridge.registerAll(toolRegistry);
```

### Skills (SKILL.md)

Skills follow Claude Code's format:

```yaml
---
name: skill-name
description: What this skill does
argument-hint: [arg1] [arg2]
allowed-tools: bash, notion
---

## Instructions
Content with $ARGUMENTS substitution
```

### Hooks (hooks.json)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [{ "type": "command", "command": "./validate.sh" }]
      }
    ]
  }
}
```

## Commands

```bash
# Development
pnpm dev              # Run terminal app
pnpm typecheck        # Type check all packages
pnpm build            # Build all packages

# Run directly
bun run packages/terminal/src/index.tsx
```

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for Claude API
- `ELEVENLABS_API_KEY` - Optional for voice TTS (future)
- `OPENAI_API_KEY` - Optional for Whisper STT (future)

## Adding a New Connector

1. Ensure the `connect-{name}` CLI is installed and in PATH
2. Add the connector name to `config/config.json` connectors array
3. The ConnectorBridge will auto-discover it on startup

## Adding a New Skill

1. Create `skills/{name}/SKILL.md` with frontmatter and instructions
2. The SkillLoader will auto-discover it on startup
3. Invoke with `/{name}` in the terminal

## Adding a New Hook

1. Edit `config/hooks.json` or `.assistants/hooks.json` (legacy: `.oldpal/hooks.json`)
2. Add hook configuration under the appropriate event
3. Hooks are loaded on startup and merged from multiple sources

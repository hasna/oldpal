# assistants

A general-purpose AI assistant designed to help with any task - from research and writing to coding, automation, and beyond. Built terminal-first with powerful integrations.

**This is not just a coding tool.** While it excels at development workflows, it's designed as a versatile assistant that can help with:
- Research and analysis
- Writing and content creation
- Task management and productivity
- Business operations
- Personal assistance
- Software development
- Automation and integrations

## Installation

```bash
bun add -g @hasna/assistants
```

**Requirements:**
- [Bun](https://bun.sh) 1.0+

## Quick Start

```bash
# Set your API key (or add to ~/.secrets)
export ANTHROPIC_API_KEY="your-key"

# Run
assistants
```

Or add to `~/.secrets`:
```bash
export ANTHROPIC_API_KEY="your-key"
```

## Features

- **General-purpose**: Handles any task - research, writing, coding, automation, and more
- **Terminal-first**: Fast, keyboard-driven interface with an Ink-based TUI
- **Connector-powered**: Integrates with services via `connect-*` CLIs (Notion, Google Drive, Gmail, Linear, Slack, etc.)
- **Skills**: Reusable instructions with `SKILL.md` files for domain-specific workflows
- **Hooks**: Event-driven automation for custom behaviors
- **Memory**: Persistent context across sessions for continuity
- **Multi-session**: Work on multiple tasks simultaneously
- **Identity management**: Switch between personas and contexts

## Configuration

User config: `~/.assistants/config.json`
Project config: `.assistants/config.json`

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-opus-4-5"
  },
  "connectors": ["notion", "googledrive", "gmail", "linear", "slack"]
}
```

## Skills

Skills are `SKILL.md` files with YAML frontmatter:

```yaml
---
name: daily-standup
description: Generate daily standup
allowed-tools: bash, googlecalendar, linear
---

Generate a daily standup report for $ARGUMENTS
```

Invoke with `/skill-name`.

## Documentation

- [Admin Dashboard](./docs/ADMIN.md) - User management, audit logging, and system monitoring

## License

MIT

# assistants

Your personal AI assistant - terminal first, connector powered.

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

- **Terminal-first**: Ink-based TUI
- **Connector-powered**: Uses `connect-*` CLIs (Notion, Google Drive, Gmail, etc.)
- **Skills**: Reusable instructions with `SKILL.md` files
- **Hooks**: Event-driven automation
- **Wait/Sleep tool**: Let the agent pause between actions with exact or ranged delays

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

## License

MIT

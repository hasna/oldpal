# @hasna/assistants-terminal

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A powerful AI assistant that runs in your terminal. Built with [Ink](https://github.com/vadimdemedes/ink) and powered by [Claude](https://www.anthropic.com/claude).

## Features

- Interactive chat with Claude AI
- Execute bash commands with approval
- Read, write, and edit files
- Fetch and search web content
- Custom skills and hooks
- Project and plan management
- Session history and resumption
- Voice input/output (optional)
- Connectors for external services

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0 or later)
- [Anthropic API key](https://console.anthropic.com/)

### Install globally

```bash
bun install -g @hasna/assistants-terminal
```

### Or run directly

```bash
bunx @hasna/assistants-terminal
```

## Quick Start

1. Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

2. Start the assistant:

```bash
assistants
# or use the short alias
ast
```

3. Start chatting!

## CLI Reference

### Basic Usage

```bash
# Start interactive mode
assistants

# Run in headless mode (non-interactive)
assistants -p "What does this codebase do?"
```

### Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |
| `-p, --print <prompt>` | Run non-interactively with the given prompt |
| `--output-format <format>` | Output format: `text` (default), `json`, `stream-json` |
| `--allowed-tools <tools>` | Comma-separated tools to auto-approve |
| `--system-prompt <prompt>` | Custom system prompt |
| `--json-schema <schema>` | JSON Schema for structured output |
| `-c, --continue` | Continue the most recent conversation |
| `-r, --resume <session_id>` | Resume a specific session by ID |
| `--cwd <path>` | Set working directory |

### Headless Mode Examples

```bash
# Ask a question
assistants -p "What does the auth module do?"

# Run with JSON output
assistants -p "Summarize this project" --output-format json

# Stream JSON events
assistants -p "Explain this code" --output-format stream-json

# Auto-approve specific tools
assistants -p "Fix the bug in auth.py" --allowed-tools "Read,Edit,Bash"

# Get structured output with JSON Schema
assistants -p "List all functions" --output-format json \
  --json-schema '{"type":"array","items":{"type":"string"}}'

# Continue a previous conversation
assistants -p "What else can you tell me?" --continue

# Resume a specific session
assistants -p "Continue from where we left off" --resume abc123
```

## Interactive Mode

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Ctrl+C` | Stop current operation or exit |
| `Ctrl+]` | Switch sessions |
| `Up/Down` | Navigate command history |
| `Tab` | Autocomplete commands |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/exit` | Exit the assistant |
| `/new` | Start a new session |
| `/clear` | Clear the screen |
| `/session` | Show current session info |
| `/tokens` | Show token usage |
| `/context` | Show/manage context window |
| `/cost` | Show estimated cost |
| `/status` | Show system status |
| `/model` | Show/change model settings |
| `/config` | Show/edit configuration |
| `/init` | Initialize project settings |

### Project & Plan Commands

| Command | Description |
|---------|-------------|
| `/projects` | List and manage projects |
| `/plans` | View and manage plans |
| `/summarize` | Summarize the conversation |
| `/compact` | Compact context to save tokens |

### Scheduling Commands

| Command | Description |
|---------|-------------|
| `/schedule` | Create a scheduled task |
| `/schedules` | List scheduled tasks |
| `/unschedule` | Remove a scheduled task |
| `/pause` | Pause a schedule |
| `/resume` | Resume a paused schedule |

### Skills & Connectors

| Command | Description |
|---------|-------------|
| `/skills` | List available skills |
| `/skill <name>` | Execute a skill |
| `/connectors` | List available connectors |

### Advanced Commands

| Command | Description |
|---------|-------------|
| `/voice` | Toggle voice mode |
| `/say <text>` | Speak text aloud |
| `/listen` | Listen for voice input |
| `/identity` | Manage agent identity |
| `/whoami` | Show current identity |
| `/assistant` | Configure assistant settings |
| `/inbox` | Check email inbox |
| `/wallet` | Manage crypto wallet |
| `/secrets` | Manage secrets |
| `/jobs` | View background jobs |
| `/messages` | Agent-to-agent messages |
| `/verification` | Manage verification sessions |
| `/memory` | View memory usage |
| `/rest` | Enter rest mode |
| `/feedback` | Submit feedback |
| `/security-log` | View security events |

## Configuration

### Directory Structure

```
~/.assistants/
├── config.json        # Global configuration
├── sessions/          # Session history
├── skills/            # Custom skills
├── hooks.json         # Global hooks
└── schedules/         # Scheduled tasks

.assistants/           # Project-level (in any directory)
├── config.json        # Project configuration
├── skills/            # Project-specific skills
└── hooks.json         # Project-specific hooks
```

### Configuration File

Create `~/.assistants/config.json`:

```json
{
  "model": "claude-sonnet-4-20250514",
  "temperature": 0.7,
  "maxTokens": 8192,
  "connectors": ["notion", "googledrive"],
  "voice": {
    "tts": "elevenlabs",
    "stt": "whisper"
  }
}
```

### Project Configuration

Create `.assistants/config.json` in your project:

```json
{
  "name": "My Project",
  "description": "Project description",
  "systemPrompt": "You are helping with a Node.js backend project.",
  "context": [
    "src/README.md",
    "docs/architecture.md"
  ]
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `ELEVENLABS_API_KEY` | No | ElevenLabs TTS |
| `OPENAI_API_KEY` | No | Whisper STT |
| `EXA_API_KEY` | No | Enhanced web search |
| `AWS_ACCESS_KEY_ID` | No | AWS features |
| `AWS_SECRET_ACCESS_KEY` | No | AWS features |
| `AWS_REGION` | No | AWS region |
| `ASSISTANTS_NO_SYNC` | No | Disable synchronized output (set to `1`) |

## Skills

Skills are reusable prompts defined in `SKILL.md` files:

```markdown
---
name: code-review
description: Review code for issues and improvements
argument-hint: <file-path>
allowed-tools: Read, Grep
---

## Instructions

Review the code at $ARGUMENTS and provide feedback on:
1. Potential bugs
2. Performance issues
3. Code style
4. Security concerns
```

Place in `~/.assistants/skills/code-review/SKILL.md` or `.assistants/skills/code-review/SKILL.md`.

Use with `/skill code-review src/auth.ts` or `$code-review src/auth.ts`.

## Hooks

Hooks allow you to run scripts before/after tool execution:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/validate-command.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/on-file-change.sh"
          }
        ]
      }
    ]
  }
}
```

## Programmatic Usage

### EmbeddedClient (Full Control)

```typescript
import { EmbeddedClient } from '@hasna/assistants-terminal';

// Create client with working directory
const client = new EmbeddedClient(process.cwd(), {
  systemPrompt: 'You are a helpful coding assistant.',
  allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
});

// Handle streaming chunks
client.onChunk((chunk) => {
  if (chunk.type === 'text' && chunk.content) {
    process.stdout.write(chunk.content);
  }
});

// Initialize and send a message
await client.initialize();
await client.send('What files are in this directory?');

// Get session info
console.log('Session ID:', client.getSessionId());
console.log('Token usage:', client.getTokenUsage());

// Cleanup
client.disconnect();
```

### Headless Mode (Simple Queries)

```typescript
import { runHeadless } from '@hasna/assistants-terminal';

// Run a simple query with JSON output
await runHeadless({
  prompt: 'Summarize this project in 3 bullet points',
  cwd: process.cwd(),
  outputFormat: 'json',
});

// Stream JSON events
await runHeadless({
  prompt: 'Explain the authentication system',
  cwd: process.cwd(),
  outputFormat: 'stream-json',
});

// Auto-approve tools
await runHeadless({
  prompt: 'Fix the bug in auth.ts',
  cwd: process.cwd(),
  outputFormat: 'text',
  allowedTools: ['Read', 'Edit'],
});
```

### Feature Detection

```typescript
import { getFeatureAvailability, getFeatureStatusMessage } from '@hasna/assistants-terminal';

// Check what features are available
const features = getFeatureAvailability();
console.log('Core chat:', features.coreChat);     // true if ANTHROPIC_API_KEY set
console.log('AWS features:', features.awsFeatures); // true if AWS configured

// Get human-readable status
console.log(getFeatureStatusMessage());
```

## Connectors

Connectors integrate external services. Install separately:

```bash
# Example: Notion connector
bun install -g @hasna/connect-notion

# List available connectors
assistants
/connectors
```

## Troubleshooting

### "ANTHROPIC_API_KEY not set"

Set your API key:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Terminal rendering issues

Try disabling synchronized output:
```bash
ASSISTANTS_NO_SYNC=1 assistants
```

### Slow startup

The first run may take longer as dependencies are cached. Subsequent runs will be faster.

### Session not found

Sessions are stored in `~/.assistants/sessions/`. Use `/session` to see current session info.

## License

MIT

## See Also

- [FEATURES.md](./FEATURES.md) - Detailed feature documentation
- [Anthropic API Documentation](https://docs.anthropic.com/)
- [Bun Documentation](https://bun.sh/docs)

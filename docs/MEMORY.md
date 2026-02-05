# Memory System

The assistants memory system provides persistent storage for agent knowledge across sessions. It supports three privacy scopes, automatic injection, and configurable retention.

## Overview

Memory allows agents to:
- Remember user preferences and settings
- Store learned facts and knowledge
- Track session history
- Share information across agents (shared scope)

## Privacy Scopes

### Global Scope
- **Visibility**: All agents and sessions
- **Use case**: System-wide settings, shared knowledge
- **Example**: `user.timezone`, `system.version`

### Shared Scope
- **Visibility**: Agents within the same scope ID (e.g., team, project)
- **Use case**: Project-specific context, team preferences
- **Example**: `project.stack`, `team.coding-style`

### Private Scope
- **Visibility**: Single agent only
- **Use case**: Agent-specific learning, personal context
- **Example**: `agent.last-task`, `session.goals`

## Memory Categories

| Category | Description | Example |
|----------|-------------|---------|
| `preference` | User settings and choices | Timezone, language, code style |
| `fact` | Known truths | User's name, project type |
| `knowledge` | Learned information | API endpoints, patterns found |
| `history` | Session context | Recent tasks, conversation topics |

## Configuration

Add to your `config.json`:

```json
{
  "memory": {
    "enabled": true,
    "injection": {
      "enabled": true,
      "maxTokens": 500,
      "minImportance": 5,
      "categories": ["preference", "fact"],
      "refreshInterval": 5
    },
    "storage": {
      "maxEntries": 1000,
      "defaultTTL": null
    },
    "scopes": {
      "globalEnabled": true,
      "sharedEnabled": true,
      "privateEnabled": true
    }
  }
}
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable the entire memory system |
| `injection.enabled` | `true` | Auto-inject memories into system prompt |
| `injection.maxTokens` | `500` | Token budget for injected memories |
| `injection.minImportance` | `5` | Minimum importance (1-10) for injection |
| `injection.categories` | `["preference", "fact"]` | Categories to auto-inject |
| `injection.refreshInterval` | `5` | Turns between memory refreshes |
| `storage.maxEntries` | `1000` | Maximum stored memories (oldest/lowest-importance pruned) |
| `storage.defaultTTL` | `null` | Default expiration in ms (null = no expiration) |
| `scopes.globalEnabled` | `true` | Allow global scope memories |
| `scopes.sharedEnabled` | `true` | Allow shared scope memories |
| `scopes.privateEnabled` | `true` | Allow private scope memories |

## Tool Usage

### memory_save

Save information to memory:

```
memory_save(
  key: "user.timezone",
  value: "America/New_York",
  category: "preference",
  importance: 8,
  summary: "User is in EST timezone",
  tags: ["user", "location"]
)
```

### memory_recall

Retrieve a specific memory or search:

```
// By key
memory_recall(key: "user.timezone")

// By search
memory_recall(search: "timezone", category: "preference", limit: 5)
```

### memory_list

List memories with filters:

```
memory_list(
  category: "preference",
  scope: "private",
  minImportance: 5,
  limit: 20
)
```

### memory_forget

Remove a memory:

```
memory_forget(key: "user.old-preference")
```

### memory_update

Update memory metadata:

```
memory_update(
  key: "user.timezone",
  importance: 10,
  tags: ["user", "critical"]
)
```

### memory_stats

Get storage statistics:

```
memory_stats()
// Returns: counts by scope, category, average importance, etc.
```

## Terminal Commands

### /memory help

Show memory command usage:

```
/memory help
```

### /memory list

List memories with optional filters:

```
/memory list
/memory list --category preference
/memory list --scope global
/memory list --importance 7
```

### /memory get

Get a specific memory:

```
/memory get user.timezone
```

### /memory set

Save a memory:

```
/memory set user.name "John Doe" --category fact --importance 8
```

### /memory delete

Remove a memory:

```
/memory delete user.old-setting
```

### /memory stats

Show memory statistics:

```
/memory stats
```

### /memory export

Export memories to JSON:

```
/memory export > memories.json
/memory export --category preference > prefs.json
```

### /memory import

Import memories from JSON:

```
/memory import memories.json
/memory import --overwrite backup.json
```

## Retention & Cleanup

### Automatic Retention

When `storage.maxEntries` is reached:
1. Expired memories are removed first
2. Lowest importance memories are pruned
3. Oldest memories are removed if tie

### TTL (Time-To-Live)

Memories can expire automatically:

```json
{
  "storage": {
    "defaultTTL": 2592000000  // 30 days in ms
  }
}
```

Or per-memory:

```
memory_save(
  key: "session.temp",
  value: "temporary data",
  ttlMs: 3600000  // 1 hour
)
```

### Manual Cleanup

Use `memory_forget` or the `/memory delete` command to remove specific memories.

## Privacy Considerations

1. **Private memories** are only accessible to the creating agent
2. **Shared memories** require matching scope IDs
3. **Global memories** are visible to all agents
4. Memory contents are stored in a local SQLite database
5. The database is located at `~/.assistants/memory.db`
6. Memory injection can be disabled via configuration

## Disabling Memory

To completely disable the memory system:

```json
{
  "memory": {
    "enabled": false
  }
}
```

To disable only auto-injection (keep manual tools):

```json
{
  "memory": {
    "enabled": true,
    "injection": {
      "enabled": false
    }
  }
}
```

## Best Practices

1. **Use meaningful keys**: `user.preference.theme` not `theme`
2. **Set appropriate importance**: 1-4 low, 5-7 normal, 8-10 critical
3. **Add summaries**: Helps with injection token budget
4. **Use tags**: Enables better filtering and organization
5. **Consider scope**: Use narrowest scope appropriate
6. **Set TTL for temporary data**: Prevents database bloat

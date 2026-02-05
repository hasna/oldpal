# Command UX Audit

This document inventories all `/commands` and classifies which should be interactive vs single-shot output.

## Classification Legend

| Type | Description |
|------|-------------|
| **Interactive** | Has or should have an interactive panel with keyboard navigation |
| **Single-shot** | Text output only, no interaction needed |
| **Hybrid** | Both modes available (text + `ui` subcommand) |
| **Action** | Triggers an action, returns immediately |

## UX Patterns

### Pattern 1: List + Detail (Interactive)
- Shows list of items with keyboard navigation (↑/↓)
- Enter to select and view details
- Press `a` or `n` to add new item
- Press `d` or `Delete` to delete selected
- Press `e` to edit selected
- Press `Escape` or `q` to close
- Example: `/tasks`, `/hooks`, `/assistants`

### Pattern 2: Table Display (Single-shot)
- Markdown table output
- Used for scripting/piping
- Example: `/schedules`, `/jobs list`

### Pattern 3: Status Dashboard (Single-shot)
- Shows current state summary
- No interaction needed
- Example: `/tokens`, `/status`, `/whoami`

### Pattern 4: Form Wizard (Interactive)
- Step-by-step input collection
- Field validation
- Example: `/hooks add` (HookWizard)

### Pattern 5: Action Commands (Single-shot)
- Execute immediately, return result
- Example: `/clear`, `/compact`, `/exit`

---

## Command Inventory

### Commands WITH Interactive Panels (Hybrid)

| Command | Panel File | Interactive? | Notes |
|---------|------------|--------------|-------|
| `/assistants` | AssistantsPanel.tsx | Yes | `/assistants ui` opens panel |
| `/tasks` | TasksPanel.tsx | Yes | `/tasks ui` opens panel |
| `/hooks` | HooksPanel.tsx | Yes | `/hooks ui` opens panel |
| `/config` | ConfigPanel.tsx | Yes | `/config` opens panel by default |
| `/connectors` | ConnectorsPanel.tsx | Yes | `/connectors` opens panel by default |
| `/identity` | IdentityPanel.tsx | Yes | `/identity` opens panel |
| `/wallet` | WalletPanel.tsx | Yes | `/wallet` opens panel |
| `/secrets` | SecretsPanel.tsx | Yes | `/secrets` opens panel |
| `/messages` | MessagesPanel.tsx | Yes | `/messages ui` opens panel |
| `/projects` | ProjectsPanel.tsx | Yes | `/projects ui` opens panel |
| `/plans` | PlansPanel.tsx | Yes | `/plans ui` opens panel |
| `/agents` | AgentsPanel.tsx | Yes | `/agents ui` opens panel |
| `/budget` | BudgetPanel.tsx | Yes | `/budget ui` opens panel |
| `/guardrails` | GuardrailsPanel.tsx | Yes | `/guardrails ui` opens panel |
| `/schedules` | SchedulesPanel.tsx | Yes | `/schedules` opens panel by default |

### Commands WITHOUT Interactive Panels (Need Assessment)

| Command | Current Type | Recommendation | Priority |
|---------|--------------|----------------|----------|
| `/schedules` | ~~Single-shot~~ **Now Hybrid** | ~~Add Interactive Panel~~ **DONE** | ~~High~~ Completed |
| `/jobs` | Single-shot (table) | **Add Interactive Panel** | Medium |
| `/inbox` | Single-shot (text) | **Add Interactive Panel** | Medium |
| `/verification` | Single-shot (text) | Keep single-shot | Low |
| `/memory` | Single-shot (text) | Consider panel for browsing | Low |
| `/skills` | Single-shot (list) | Consider panel | Low |
| `/swarm` | Single-shot (status) | Keep single-shot | Low |

### Commands That Should Remain Single-shot

| Command | Reason |
|---------|--------|
| `/help` | Quick reference, scannable |
| `/clear` | Action command |
| `/new` | Action command |
| `/exit` | Action command |
| `/tokens` | Simple status display |
| `/status` | Simple status display |
| `/session` | Session management (terminal handles) |
| `/context` | Data management (text sufficient) |
| `/summarize` | Triggers LLM operation |
| `/rest` | Action command |
| `/skill` | Invokes a skill |
| `/compact` | Action command |
| `/cost` | Simple display |
| `/model` | Quick switch |
| `/schedule` | Creates schedule (text sufficient) |
| `/unschedule` | Deletes schedule (text sufficient) |
| `/pause` | Action command |
| `/resume` | Action command |
| `/feedback` | Submits feedback |
| `/init` | Project initialization |
| `/voice`, `/say`, `/listen` | Voice control |
| `/whoami` | Simple identity display |

---

## Detailed Recommendations

### 1. `/schedules` - High Priority

**Current**: Table output only
```
| ID | Status | Next Run | Command |
|----|--------|----------|---------|
```

**Proposed Interactive Panel**: `SchedulesPanel.tsx`
- List view with columns: Status icon, Next Run (relative), Command preview
- Enter: View full schedule details
- `p`: Pause selected schedule
- `r`: Resume selected schedule
- `d`: Delete selected schedule
- `n`: Create new schedule (opens wizard)
- Show countdown timers for upcoming schedules
- Color coding: green (active), yellow (paused), red (failed)

**UX Enhancement**: Show "runs in 5m" relative times instead of ISO dates.

---

### 2. `/jobs` - Medium Priority

**Current**: Table output only

**Proposed Interactive Panel**: `JobsPanel.tsx`
- List view showing: Status icon, Job type, Started at, Duration
- Enter: View job details (input, output, errors)
- Filter by status (running, completed, failed)
- `c`: Cancel running job
- `d`: Delete job record
- Auto-refresh for running jobs
- Show progress indicators for long-running jobs

---

### 3. `/inbox` - Medium Priority

**Current**: Text list

**Proposed Interactive Panel**: `InboxPanel.tsx`
- Message list with sender, subject, time
- Enter: View full message
- `m`: Mark as read
- `d`: Delete message
- `r`: Reply (opens input)
- Unread count badge
- Group by sender or date

---

### 4. `/checks` - If Command Exists

**Check if a `/checks` command exists or should be created for:**
- Health checks
- System validation
- Pre-flight checks

---

## Implementation Notes

### Interactive Panel Template

```tsx
// Pattern for new interactive panels
function Panel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<'list' | 'detail'>('list');

  useInput((input, key) => {
    if (key.escape || input === 'q') onClose();
    if (key.upArrow) setSelectedIndex(i => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIndex(i => Math.min(items.length - 1, i + 1));
    if (key.return) setView('detail');
  });

  return view === 'list' ? <ListView /> : <DetailView />;
}
```

### Keyboard Navigation Standards

| Key | Action |
|-----|--------|
| `↑`/`↓` | Navigate list |
| `Enter` | Select/Open detail |
| `Escape`/`q` | Close panel / Go back |
| `n`/`a` | New/Add item |
| `d`/`Delete` | Delete item |
| `e` | Edit item |
| `r` | Refresh |
| `/` | Search/Filter |
| `Tab` | Switch tabs (if applicable) |

### Timer Display Standards

For commands showing times:
- Past: "2m ago", "1h ago", "yesterday"
- Future: "in 5m", "in 2h", "tomorrow at 9am"
- Show exact time on hover/detail view

---

## Tasks Generated from This Audit

1. **#1077** - Interactive /schedules panel (High priority)
2. **#1078** - Schedules list table improvements (before panel)
3. **#1079** - Interactive /tasks panel enhancements
4. **#1080** - Interactive /checks panel (if command exists)
5. **#1081** - Interactive command UX guidelines (this document)

---

## Summary

| Category | Count |
|----------|-------|
| Commands with panels | 14 |
| Commands needing panels | 3 |
| Single-shot commands | 19 |
| Total commands | 36+ |

The interactive panel pattern is well-established in the codebase. New panels should follow the existing patterns in `AssistantsPanel.tsx` and `TasksPanel.tsx` for consistency.

---

## Interactive Panel Implementation Guide

### Required Props Interface

All interactive panels should accept these standard props:

```typescript
interface PanelProps {
  // Data props
  items: Item[];

  // Action handlers
  onAdd?: (item: ItemInput) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onUpdate?: (id: string, updates: Partial<Item>) => Promise<void>;
  onRefresh?: () => Promise<void>;

  // Navigation
  onClose: () => void;
}
```

### State Management Pattern

```typescript
function Panel({ items, onClose }: PanelProps) {
  // Navigation state
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<'list' | 'detail' | 'create' | 'delete-confirm'>('list');

  // Loading state
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state (for create mode)
  const [formData, setFormData] = useState<Partial<Item>>({});

  // Adjust selected index when items change
  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(0, items.length - 1)));
  }, [items.length]);
}
```

### Color Coding Standards

| State | Color | Example Use |
|-------|-------|-------------|
| Active/Running | `yellow` | In-progress tasks |
| Success/Completed | `green` | Completed items |
| Error/Failed | `red` | Failed operations |
| Paused/Inactive | `gray` | Paused schedules |
| Selected | `inverse` | Current selection |
| Dimmed | `dimColor` | Secondary info |
| Highlight | `cyan` | Actions, links |

### Status Icons

| Status | Icon | Color |
|--------|------|-------|
| Pending | `○` | default |
| In Progress | `◐` | yellow |
| Completed | `●` | green |
| Failed | `✗` | red |
| Paused | `◐` | yellow |
| Active | `●` | green |

### Accessibility Considerations

1. **Keyboard-first navigation**: All actions must be accessible via keyboard
2. **Visual feedback**: Selection must be clearly visible (use `inverse`)
3. **Action confirmation**: Destructive actions require confirmation
4. **Help text**: Show available shortcuts at bottom of panel
5. **Status announcements**: Show loading states for async operations

### Feedback Patterns

1. **Loading state**: Show "Processing..." text during async operations
2. **Confirmation dialogs**: Y/N prompts for destructive actions
3. **Success messages**: Brief confirmation after successful actions
4. **Error messages**: Clear error text with actionable guidance

### Mode Transitions

```
┌─────────┐
│  List   │ ─── Enter ──→ ┌──────────┐
│         │ ←── Escape ── │  Detail  │
└─────────┘               └──────────┘
     │                          │
     │ n/a                      │ d
     ▼                          ▼
┌─────────┐              ┌──────────────┐
│ Create  │              │ Delete       │
│  Form   │              │ Confirm      │
└─────────┘              └──────────────┘
```

### Wiring Up in App.tsx

1. Import the panel component
2. Add state for showing the panel and data
3. Handle the `showPanel` return value in stream handler
4. Render the panel with appropriate handlers

```typescript
// 1. Import
import { MyPanel } from './MyPanel';

// 2. State
const [showMyPanel, setShowMyPanel] = useState(false);
const [myPanelData, setMyPanelData] = useState<Item[]>([]);

// 3. Handle showPanel
if (chunk.panel === 'mypanel') {
  fetchData().then(data => {
    setMyPanelData(data);
    setShowMyPanel(true);
  });
}

// 4. Render
if (showMyPanel) {
  return (
    <Box padding={1}>
      <MyPanel
        items={myPanelData}
        onClose={() => setShowMyPanel(false)}
      />
    </Box>
  );
}
```

### Command Handler Pattern

```typescript
private myCommand(): Command {
  return {
    name: 'mycommand',
    description: 'Description',
    builtin: true,
    selfHandled: true,
    content: '',
    handler: async (args, context) => {
      const trimmed = args.trim().toLowerCase();

      // Show panel for no args or 'ui'
      if (!trimmed || trimmed === 'ui') {
        context.emit('done');
        return { handled: true, showPanel: 'mypanel' };
      }

      // Text output for 'list'
      if (trimmed === 'list') {
        // ... text output
        return { handled: true };
      }

      // Show help for other args
      context.emit('text', 'Usage: /mycommand [ui|list]\n');
      context.emit('done');
      return { handled: true };
    },
  };
}
```

---

## Completed Tasks

- [x] #1076 - Audit /commands for interactive UX needs
- [x] #1077 - Interactive /schedules panel
- [x] #1078 - Schedules list table improvements
- [x] #1079 - Interactive /tasks panel enhancements
- [x] #1080 - Interactive /checks panel (deferred - no clear requirements)
- [x] #1081 - Interactive command UX guidelines (this document)

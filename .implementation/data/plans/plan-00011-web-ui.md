# Plan: Web UI Implementation

**Plan ID:** 00011
**Status:** In Progress
**Priority:** Low
**Estimated Effort:** Large (10+ days)
**Dependencies:** plan-00002 (Error Handling)

---

## Overview

Create a web-based UI as an alternative to the terminal interface. The web UI will share the core agent logic but provide a rich graphical interface with features like file preview, syntax highlighting, and visual tool outputs.

## Current State

- Terminal-only interface
- packages/web exists but is empty/placeholder
- No HTTP server for web interface
- No WebSocket for real-time communication

## Requirements

### Functional
1. Chat interface similar to Claude.ai
2. Real-time streaming of responses
3. Syntax-highlighted code blocks
4. File preview capabilities
5. Tool execution visualization
6. Session management

### Non-Functional
1. Fast initial load (<2s)
2. Responsive design
3. Keyboard shortcuts
4. Accessible interface
5. Works offline (PWA)

## Technical Design

### Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **State**: Zustand
- **Real-time**: WebSocket
- **Components**: shadcn/ui

### Architecture

```
packages/web/
├── src/
│   ├── app/
│   │   ├── page.tsx           # Main chat interface
│   │   ├── layout.tsx         # Root layout
│   │   ├── api/
│   │   │   ├── chat/route.ts  # Chat endpoint
│   │   │   └── ws/route.ts    # WebSocket upgrade
│   │   └── settings/
│   │       └── page.tsx       # Settings page
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatContainer.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── InputArea.tsx
│   │   │   └── ToolCallCard.tsx
│   │   ├── ui/                # shadcn components
│   │   └── shared/
│   │       ├── Header.tsx
│   │       ├── Sidebar.tsx
│   │       └── CommandPalette.tsx
│   ├── lib/
│   │   ├── agent.ts           # Agent client
│   │   ├── ws.ts              # WebSocket client
│   │   └── store.ts           # Zustand store
│   └── styles/
│       └── globals.css
```

### WebSocket Protocol

```typescript
// packages/web/src/lib/protocol.ts

// Client -> Server messages
type ClientMessage =
  | { type: 'message'; content: string }
  | { type: 'cancel' }
  | { type: 'tool_response'; toolId: string; response: string };

// Server -> Client messages
type ServerMessage =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; id: string; name: string; input: any }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'message_complete' }
  | { type: 'error'; message: string };
```

### Chat Components

```typescript
// packages/web/src/components/chat/MessageBubble.tsx

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  return (
    <div className={cn(
      "flex gap-3 p-4",
      message.role === 'user' ? 'justify-end' : 'justify-start'
    )}>
      {message.role === 'assistant' && (
        <Avatar className="w-8 h-8">
          <AvatarFallback>AI</AvatarFallback>
        </Avatar>
      )}

      <div className={cn(
        "max-w-[80%] rounded-lg p-3",
        message.role === 'user'
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted'
      )}>
        <MarkdownRenderer content={message.content} />

        {message.toolCalls?.map(call => (
          <ToolCallCard key={call.id} call={call} />
        ))}

        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-current animate-pulse" />
        )}
      </div>
    </div>
  );
}
```

```typescript
// packages/web/src/components/chat/ToolCallCard.tsx

interface ToolCallCardProps {
  call: ToolCall;
}

export function ToolCallCard({ call }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="mt-2">
      <CardHeader
        className="py-2 px-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <ToolIcon name={call.name} className="w-4 h-4" />
          <span className="font-mono text-sm">{call.name}</span>
          {call.result?.isError && (
            <Badge variant="destructive">Error</Badge>
          )}
          <ChevronRight className={cn(
            "ml-auto transition-transform",
            expanded && "rotate-90"
          )} />
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="py-2 px-3">
          <div className="space-y-2">
            <div>
              <Label>Input</Label>
              <pre className="bg-muted p-2 rounded text-xs overflow-auto">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
            {call.result && (
              <div>
                <Label>Output</Label>
                <pre className={cn(
                  "p-2 rounded text-xs overflow-auto",
                  call.result.isError ? "bg-destructive/10" : "bg-muted"
                )}>
                  {call.result.output}
                </pre>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
```

### State Management

```typescript
// packages/web/src/lib/store.ts

import { create } from 'zustand';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentToolCalls: ToolCall[];

  addMessage: (message: Message) => void;
  updateLastMessage: (content: string) => void;
  setStreaming: (streaming: boolean) => void;
  addToolCall: (call: ToolCall) => void;
  updateToolResult: (id: string, result: ToolResult) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentToolCalls: [],

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),

  updateLastMessage: (content) => set((state) => {
    const messages = [...state.messages];
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.content += content;
    }
    return { messages };
  }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  addToolCall: (call) => set((state) => ({
    currentToolCalls: [...state.currentToolCalls, call],
  })),

  updateToolResult: (id, result) => set((state) => ({
    currentToolCalls: state.currentToolCalls.map(call =>
      call.id === id ? { ...call, result } : call
    ),
  })),

  clearMessages: () => set({ messages: [], currentToolCalls: [] }),
}));
```

### WebSocket Client

```typescript
// packages/web/src/lib/ws.ts

class ChatWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(url: string): void {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      this.handleMessage(message);
    };

    this.ws.onclose = () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(url), 1000 * this.reconnectAttempts);
      }
    };
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: ServerMessage): void {
    const store = useChatStore.getState();

    switch (message.type) {
      case 'text_delta':
        store.updateLastMessage(message.content);
        break;
      case 'tool_call':
        store.addToolCall({
          id: message.id,
          name: message.name,
          input: message.input,
        });
        break;
      case 'tool_result':
        store.updateToolResult(message.id, {
          output: message.output,
          isError: message.isError,
        });
        break;
      case 'message_complete':
        store.setStreaming(false);
        break;
      case 'error':
        // Handle error
        break;
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export const chatWs = new ChatWebSocket();
```

## Implementation Steps

### Step 1: Setup Next.js Project
- [x] Initialize Next.js with App Router
- [x] Configure Tailwind CSS
- [ ] Add shadcn/ui
- [x] Setup project structure

**Files:**
- `packages/web/package.json`
- `packages/web/next.config.js`
- `packages/web/tailwind.config.js`

### Step 2: Create Core Components
- [x] Build MessageBubble
- [x] Build MessageList
- [x] Build InputArea
- [x] Build ToolCallCard

**Files:**
- `packages/web/src/components/chat/*.tsx`

### Step 3: Implement State Management
- [x] Create Zustand store
- [x] Add message state
- [x] Add streaming state
- [x] Add tool call state

**Files:**
- `packages/web/src/lib/store.ts`

### Step 4: Implement WebSocket
- [x] Create WebSocket client
- [x] Define protocol types
- [x] Handle reconnection
- [x] Integrate with store

**Files:**
- `packages/web/src/lib/ws.ts`
- `packages/web/src/lib/protocol.ts`

### Step 5: Create API Routes
- [x] Create chat endpoint
- [x] Create WebSocket upgrade handler
- [x] Integrate with core agent

**Files:**
- `packages/web/src/app/api/chat/route.ts`
- `packages/web/src/app/api/ws/route.ts`

### Step 6: Build Main Interface
- [x] Create chat page
- [x] Add sidebar
- [x] Add header
- [x] Add settings page

**Files:**
- `packages/web/src/app/page.tsx`
- `packages/web/src/app/layout.tsx`
- `packages/web/src/app/settings/page.tsx`

### Step 7: Add Features
- [x] Syntax highlighting
- [x] File preview
- [x] Command palette
- [x] Keyboard shortcuts

**Files:**
- Various component files

### Step 8: Add PWA Support
- [ ] Create manifest
- [ ] Add service worker
- [ ] Handle offline

**Files:**
- `packages/web/public/manifest.json`
- `packages/web/src/app/sw.ts`

### Step 9: Add Tests
- [ ] Component tests
- [ ] Integration tests
- [ ] E2E tests

**Files:**
- `packages/web/tests/*.test.tsx`

## Testing Strategy

```typescript
describe('MessageBubble', () => {
  it('should render user messages');
  it('should render assistant messages');
  it('should show streaming indicator');
  it('should render tool calls');
});

describe('ChatWebSocket', () => {
  it('should connect to server');
  it('should handle messages');
  it('should reconnect on disconnect');
});
```

## Rollout Plan

1. Setup Next.js project
2. Build core chat components
3. Implement state management
4. Add WebSocket communication
5. Create API routes
6. Build main interface
7. Add advanced features
8. PWA support
9. Testing and polish

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feature parity with terminal | Medium | Shared core logic, feature checklist |
| WebSocket reliability | Medium | Reconnection logic, HTTP fallback |
| Performance with long chats | Medium | Virtualized lists, pagination |
| Security | High | Auth, CORS, input validation |

---

## Approval

- [ ] Technical design approved
- [ ] Implementation steps clear
- [ ] Tests defined
- [ ] Ready to implement

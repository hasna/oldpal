import type { ClientMessage, ServerMessage } from './protocol';
import { useChatStore } from './store';

class ChatWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private url = '';
  private token: string | null = null;
  private pending: ClientMessage[] = [];
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Track the active session to guard against late messages from previous sessions
  private activeSessionId: string | null = null;

  connect(url: string, token?: string | null): void {
    this.token = token ?? null;
    // Close existing connection to avoid duplicate streams
    if (this.ws) {
      // Temporarily disable reconnect for the old socket
      const oldWs = this.ws;
      oldWs.onclose = null;
      oldWs.onerror = null;
      oldWs.onmessage = null;
      oldWs.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.shouldReconnect = true;
    this.url = url;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      // Send auth message first (if token available) to authenticate without URL exposure
      if (this.token) {
        this.ws?.send(JSON.stringify({ type: 'auth', token: this.token }));
      }
      const store = useChatStore.getState();
      const currentSessionId = store.sessionId || store.createSession('Session 1');
      if (currentSessionId) {
        this.activeSessionId = currentSessionId;
        this.ws?.send(JSON.stringify({ type: 'session', sessionId: currentSessionId }));
      }
      if (this.pending.length > 0) {
        for (const message of this.pending) {
          this.ws?.send(JSON.stringify(message));
        }
        this.pending = [];
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        this.handleMessage(message);
      } catch {
        // Ignore malformed messages to avoid crashing the client
      }
    };

    this.ws.onclose = () => {
      if (!this.shouldReconnect) {
        this.pending = [];
        return;
      }
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts += 1;
        const retryDelay = 1000 * this.reconnectAttempts;
        this.reconnectTimer = setTimeout(() => this.connect(this.url, this.token), retryDelay);
      } else {
        const store = useChatStore.getState();
        store.finalizeToolCalls();
        store.setStreaming(false);
        store.clearToolCalls();
        this.pending = [];
      }
    };
  }

  send(message: ClientMessage): void {
    // Track session changes to guard against late messages from previous sessions
    if (message.type === 'session') {
      // Session changed - clear any pending messages for the old session
      // to prevent wrong-session ordering on reconnect
      if (this.activeSessionId && this.activeSessionId !== message.sessionId) {
        this.pending = this.pending.filter((m) => m.type === 'auth');
      }
      this.activeSessionId = message.sessionId;
    } else if (message.type === 'message' && message.sessionId) {
      this.activeSessionId = message.sessionId;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    this.pending.push(message);
    if (this.url && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
      this.connect(this.url, this.token);
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.pending = [];
    this.activeSessionId = null;
  }

  private handleMessage(message: ServerMessage): void {
    const store = useChatStore.getState();

    // Guard against late messages from previous sessions
    // If the store's sessionId doesn't match the active session we're streaming for,
    // drop the message to prevent cross-session contamination
    if (this.activeSessionId && store.sessionId !== this.activeSessionId) {
      // Session changed, drop this late message
      return;
    }

    switch (message.type) {
      case 'text_delta':
        store.setStreaming(true);
        store.appendMessageContent(message.messageId, message.content);
        break;
      case 'tool_call':
        store.setStreaming(true);
        store.addToolCall({
          id: message.id,
          name: message.name,
          input: message.input as Record<string, unknown>,
        }, message.messageId);
        break;
      case 'tool_result':
        store.setStreaming(true);
        store.updateToolResult(message.id, {
          toolCallId: message.id,
          content: message.output,
          isError: message.isError,
        });
        break;
      case 'message_complete':
        store.finalizeToolCalls(message.messageId);
        store.setStreaming(false);
        store.clearToolCalls();
        break;
      case 'error':
        if (message.message) {
          store.appendMessageContent(message.messageId, `\n[Error: ${message.message}]`);
        }
        store.finalizeToolCalls(message.messageId);
        store.setStreaming(false);
        store.clearToolCalls();
        break;
      default:
        break;
    }
  }
}

export const chatWs = new ChatWebSocket();

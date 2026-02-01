import type { ClientMessage, ServerMessage } from './protocol';
import { useChatStore } from './store';

class ChatWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private url = '';
  private pending: ClientMessage[] = [];

  connect(url: string): void {
    this.url = url;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      const store = useChatStore.getState();
      const currentSessionId = store.sessionId || store.createSession('Session 1');
      if (currentSessionId) {
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
      const message = JSON.parse(event.data) as ServerMessage;
      this.handleMessage(message);
    };

    this.ws.onclose = () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts += 1;
        const retryDelay = 1000 * this.reconnectAttempts;
        setTimeout(() => this.connect(this.url), retryDelay);
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
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }
    this.pending.push(message);
    if (this.url && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
      this.connect(this.url);
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.pending = [];
  }

  private handleMessage(message: ServerMessage): void {
    const store = useChatStore.getState();

    switch (message.type) {
      case 'text_delta':
        store.setStreaming(true);
        store.updateLastMessage(message.content);
        break;
      case 'tool_call':
        store.setStreaming(true);
        store.addToolCall({
          id: message.id,
          name: message.name,
          input: message.input,
          type: 'tool',
        });
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
        store.finalizeToolCalls();
        store.setStreaming(false);
        store.clearToolCalls();
        break;
      case 'error':
        store.finalizeToolCalls();
        store.setStreaming(false);
        store.clearToolCalls();
        break;
      default:
        break;
    }
  }
}

export const chatWs = new ChatWebSocket();

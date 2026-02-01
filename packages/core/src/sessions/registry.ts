import type { StreamChunk, Message, TokenUsage } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import { EmbeddedClient } from '../client';

/**
 * Information about a session
 */
export interface SessionInfo {
  id: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  isProcessing: boolean;
  client: EmbeddedClient;
}

/**
 * Persisted session state for switching
 */
export interface PersistedSession {
  id: string;
  cwd: string;
  startedAt: number;
  messages: Message[];
  tokenUsage: TokenUsage;
}

/**
 * Registry that manages multiple concurrent sessions
 */
export class SessionRegistry {
  private sessions: Map<string, SessionInfo> = new Map();
  private activeSessionId: string | null = null;
  private chunkBuffers: Map<string, StreamChunk[]> = new Map();
  private chunkCallbacks: ((chunk: StreamChunk) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];
  private clientFactory: (cwd: string) => EmbeddedClient;

  constructor(clientFactory?: (cwd: string) => EmbeddedClient) {
    this.clientFactory = clientFactory ?? ((cwd) => new EmbeddedClient(cwd));
  }

  /**
   * Create a new session
   */
  async createSession(cwd: string): Promise<SessionInfo> {
    const client = this.clientFactory(cwd);
    await client.initialize();

    const sessionInfo: SessionInfo = {
      id: client.getSessionId(),
      cwd,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      isProcessing: false,
      client,
    };

    // Setup chunk forwarding/buffering
    client.onChunk((chunk) => {
      this.handleChunk(sessionInfo.id, chunk);
    });

    client.onError((error) => {
      if (this.activeSessionId === sessionInfo.id) {
        for (const callback of this.errorCallbacks) {
          callback(error);
        }
      }
    });

    this.sessions.set(sessionInfo.id, sessionInfo);
    this.chunkBuffers.set(sessionInfo.id, []);

    // If this is the first session, make it active
    if (this.activeSessionId === null) {
      this.activeSessionId = sessionInfo.id;
    }

    return sessionInfo;
  }

  /**
   * Handle chunks - forward to UI if active, buffer if background
   */
  private handleChunk(sessionId: string, chunk: StreamChunk): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updatedAt = Date.now();

      // Track processing state
      if (chunk.type === 'text' || chunk.type === 'tool_use' || chunk.type === 'tool_result') {
        session.isProcessing = true;
      }
      if (chunk.type === 'done' || chunk.type === 'error' || chunk.type === 'exit') {
        session.isProcessing = false;
      }
    }

    if (sessionId === this.activeSessionId) {
      // Forward to UI immediately
      for (const callback of this.chunkCallbacks) {
        callback(chunk);
      }
    } else {
      // Buffer for later
      const buffer = this.chunkBuffers.get(sessionId);
      if (buffer) {
        buffer.push(chunk);
      }
    }
  }

  /**
   * Switch to a different session
   */
  async switchSession(id: string): Promise<void> {
    if (!this.sessions.has(id)) {
      throw new Error(`Session ${id} not found`);
    }

    if (this.activeSessionId === id) {
      return; // Already active
    }

    this.activeSessionId = id;

    // Replay any buffered chunks from the new active session
    const buffer = this.chunkBuffers.get(id);
    if (buffer && buffer.length > 0) {
      for (const chunk of buffer) {
        for (const callback of this.chunkCallbacks) {
          callback(chunk);
        }
      }
      // Clear the buffer after replay
      this.chunkBuffers.set(id, []);
    }
  }

  /**
   * List all sessions
   */
  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  /**
   * Get the currently active session
   */
  getActiveSession(): SessionInfo | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) || null;
  }

  /**
   * Get the active session ID
   */
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  /**
   * Get session by ID
   */
  getSession(id: string): SessionInfo | null {
    return this.sessions.get(id) || null;
  }

  /**
   * Get session index (1-based) for display
   */
  getSessionIndex(id: string): number {
    const sessions = this.listSessions();
    return sessions.findIndex((s) => s.id === id) + 1;
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Close a specific session
   */
  closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.client.disconnect();
      this.sessions.delete(id);
      this.chunkBuffers.delete(id);

      // If we closed the active session, switch to another
      if (this.activeSessionId === id) {
        const remaining = this.listSessions();
        this.activeSessionId = remaining.length > 0 ? remaining[0].id : null;
      }
    }
  }

  /**
   * Close all sessions (called on app exit)
   */
  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.client.disconnect();
    }
    this.sessions.clear();
    this.chunkBuffers.clear();
    this.activeSessionId = null;
  }

  /**
   * Register a chunk callback
   */
  onChunk(callback: (chunk: StreamChunk) => void): void {
    this.chunkCallbacks.push(callback);
  }

  /**
   * Register an error callback
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * Mark a session as processing
   */
  setProcessing(id: string, isProcessing: boolean): void {
    const session = this.sessions.get(id);
    if (session) {
      session.isProcessing = isProcessing;
      session.updatedAt = Date.now();
    }
  }

  /**
   * Check if any session is currently processing
   */
  hasProcessingSession(): boolean {
    for (const session of this.sessions.values()) {
      if (session.isProcessing) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get sessions that are processing in background
   */
  getBackgroundProcessingSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.isProcessing && s.id !== this.activeSessionId
    );
  }
}

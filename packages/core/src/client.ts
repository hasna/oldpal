import type { AssistantClient, StreamChunk, Tool, Skill, Message, TokenUsage } from '@oldpal/shared';
import { generateId } from '@oldpal/shared';
import { AgentLoop } from './agent/loop';
import { Logger, SessionStorage, initOldpalDir } from './logger';
import type { Command } from './commands';

/**
 * Embedded client - runs the agent in the same process
 */
export class EmbeddedClient implements AssistantClient {
  private agent: AgentLoop;
  private chunkCallbacks: ((chunk: StreamChunk) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];
  private initialized = false;
  private logger: Logger;
  private session: SessionStorage;
  private messages: Message[] = [];
  private cwd: string;
  private startedAt: string;
  private initialMessages: Message[] | null = null;

  constructor(
    cwd?: string,
    options?: { sessionId?: string; initialMessages?: Message[]; systemPrompt?: string; allowedTools?: string[]; startedAt?: string }
  ) {
    // Initialize .oldpal directory structure
    initOldpalDir();

    const sessionId = options?.sessionId || generateId();
    this.logger = new Logger(sessionId);
    this.session = new SessionStorage(sessionId);
    this.cwd = cwd || process.cwd();
    this.startedAt = options?.startedAt || new Date().toISOString();
    this.initialMessages = options?.initialMessages || null;

    this.logger.info('Session started', { cwd: this.cwd });

    this.agent = new AgentLoop({
      cwd: this.cwd,
      sessionId,
      allowedTools: options?.allowedTools,
      extraSystemPrompt: options?.systemPrompt,
      onChunk: (chunk) => {
        for (const callback of this.chunkCallbacks) {
          callback(chunk);
        }
      },
      onToolStart: (toolCall) => {
        // Only log - tool_use chunk is already emitted from LLM stream
        this.logger.info('Tool started', { tool: toolCall.name, input: toolCall.input });
      },
      onToolEnd: (toolCall, result) => {
        this.logger.info('Tool completed', {
          tool: toolCall.name,
          success: !result.isError,
          resultLength: result.content.length,
        });
      },
    });
  }

  /**
   * Initialize the client (must be called before use)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.logger.info('Initializing agent');
    await this.agent.initialize();
    if (this.initialMessages && this.initialMessages.length > 0) {
      this.agent.getContext().import(this.initialMessages);
      this.messages = [...this.initialMessages];
    }
    this.initialized = true;
    this.logger.info('Agent initialized', {
      tools: this.agent.getTools().length,
      skills: this.agent.getSkills().length,
    });
  }

  /**
   * Send a message to the assistant
   */
  async send(message: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.logger.info('User message', { message });

    try {
      await this.agent.process(message);

      // Get assistant response from context
      const context = this.agent.getContext();
      const contextMessages = context.getMessages();
      if (contextMessages.length > 0) {
        this.messages = contextMessages;
        const lastMessage = contextMessages.slice(-1)[0];
        if (lastMessage?.role === 'assistant') {
          this.logger.info('Assistant response', {
            length: lastMessage.content.length,
            hasToolCalls: !!lastMessage.toolCalls?.length,
          });
        }
      }

      // Save session
      this.saveSession();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Error processing message', { error: err.message });
      for (const callback of this.errorCallbacks) {
        callback(err);
      }
    }
  }

  private saveSession() {
    this.session.save({
      messages: this.messages,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      cwd: this.cwd,
    });
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
   * Get available tools
   */
  async getTools(): Promise<Tool[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.agent.getTools();
  }

  /**
   * Get available skills
   */
  async getSkills(): Promise<Skill[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.agent.getSkills();
  }

  /**
   * Stop the current processing
   */
  stop(): void {
    this.logger.info('Processing stopped by user');
    this.agent.stop();
  }

  /**
   * Disconnect (no-op for embedded client)
   */
  disconnect(): void {
    this.logger.info('Session ended');
    this.saveSession();
  }

  /**
   * Check if agent is currently processing
   */
  isProcessing(): boolean {
    return this.agent.isProcessing();
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.session.getSessionId();
  }

  /**
   * Get available commands
   */
  async getCommands(): Promise<Command[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.agent.getCommands();
  }

  /**
   * Get current token usage
   */
  getTokenUsage(): TokenUsage {
    return this.agent.getTokenUsage();
  }

  /**
   * Clear the conversation
   */
  clearConversation(): void {
    this.agent.clearConversation();
    this.messages = [];
    this.logger.info('Conversation cleared');
  }

  /**
   * Get working directory
   */
  getCwd(): string {
    return this.cwd;
  }

  /**
   * Get start time
   */
  getStartedAt(): string {
    return this.startedAt;
  }

  /**
   * Get messages
   */
  getMessages(): Message[] {
    return [...this.messages];
  }
}

import type { Message, Tool, StreamChunk, ToolCall, ToolResult, OldpalConfig } from '@oldpal/shared';
import { generateId } from '@oldpal/shared';
import { AgentContext } from './context';
import { ToolRegistry } from '../tools/registry';
import { ConnectorBridge } from '../tools/connector';
import { BashTool } from '../tools/bash';
import { FilesystemTools } from '../tools/filesystem';
import { WebTools } from '../tools/web';
import { SkillLoader } from '../skills/loader';
import { SkillExecutor } from '../skills/executor';
import { HookLoader } from '../hooks/loader';
import { HookExecutor } from '../hooks/executor';
import { CommandLoader, CommandExecutor, BuiltinCommands, type TokenUsage, type CommandContext } from '../commands';
import { createLLMClient, type LLMClient } from '../llm/client';
import { loadConfig, loadHooksConfig, loadSystemPrompt, ensureConfigDir } from '../config';

export interface AgentLoopOptions {
  config?: OldpalConfig;
  cwd?: string;
  sessionId?: string;
  onChunk?: (chunk: StreamChunk) => void;
  onToolStart?: (toolCall: ToolCall) => void;
  onToolEnd?: (toolCall: ToolCall, result: ToolResult) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
}

/**
 * Main agent loop - orchestrates the conversation
 */
export class AgentLoop {
  private context: AgentContext;
  private toolRegistry: ToolRegistry;
  private connectorBridge: ConnectorBridge;
  private skillLoader: SkillLoader;
  private skillExecutor: SkillExecutor;
  private hookLoader: HookLoader;
  private hookExecutor: HookExecutor;
  private commandLoader: CommandLoader;
  private commandExecutor: CommandExecutor;
  private builtinCommands: BuiltinCommands;
  private llmClient: LLMClient | null = null;
  private config: OldpalConfig | null = null;
  private cwd: string;
  private sessionId: string;
  private isRunning = false;
  private shouldStop = false;

  // Event callbacks
  private onChunk?: (chunk: StreamChunk) => void;
  private onToolStart?: (toolCall: ToolCall) => void;
  private onToolEnd?: (toolCall: ToolCall, result: ToolResult) => void;
  private onTokenUsage?: (usage: TokenUsage) => void;

  constructor(options: AgentLoopOptions = {}) {
    this.cwd = options.cwd || process.cwd();
    this.sessionId = options.sessionId || generateId();
    this.context = new AgentContext();
    this.toolRegistry = new ToolRegistry();
    this.connectorBridge = new ConnectorBridge();
    this.skillLoader = new SkillLoader();
    this.skillExecutor = new SkillExecutor();
    this.hookLoader = new HookLoader();
    this.hookExecutor = new HookExecutor();
    this.commandLoader = new CommandLoader(this.cwd);
    this.commandExecutor = new CommandExecutor(this.commandLoader);
    this.builtinCommands = new BuiltinCommands();

    this.onChunk = options.onChunk;
    this.onToolStart = options.onToolStart;
    this.onToolEnd = options.onToolEnd;
    this.onTokenUsage = options.onTokenUsage;
  }

  /**
   * Initialize the agent (parallelized for fast startup)
   */
  async initialize(): Promise<void> {
    // Phase 1: Load config and ensure directories exist (fast, needed for phase 2)
    const [config] = await Promise.all([
      loadConfig(this.cwd),
      ensureConfigDir(),
    ]);
    this.config = config;

    // Phase 2: All independent async operations in parallel
    const [, , , hooksConfig, systemPrompt] = await Promise.all([
      // Initialize LLM client
      createLLMClient(this.config.llm).then((client) => {
        this.llmClient = client;
      }),
      // Discover connectors
      this.connectorBridge.discover(this.config.connectors),
      // Load skills
      this.skillLoader.loadAll(this.cwd),
      // Load hooks config
      loadHooksConfig(this.cwd),
      // Load system prompt
      loadSystemPrompt(this.cwd),
      // Load commands
      this.commandLoader.loadAll(),
    ]);

    // Phase 3: Sync operations (fast)
    // Register built-in tools
    this.toolRegistry.register(BashTool.tool, BashTool.executor);
    FilesystemTools.registerAll(this.toolRegistry);
    WebTools.registerAll(this.toolRegistry);

    // Register connector tools
    this.connectorBridge.registerAll(this.toolRegistry);

    // Register builtin commands
    this.builtinCommands.registerAll(this.commandLoader);

    // Load hooks
    this.hookLoader.load(hooksConfig);

    // Set system prompt
    if (systemPrompt) {
      this.context.addSystemMessage(systemPrompt);
    }

    // Run session start hooks
    await this.hookExecutor.execute(this.hookLoader.getHooks('SessionStart'), {
      session_id: this.sessionId,
      hook_event_name: 'SessionStart',
      cwd: this.cwd,
    });
  }

  /**
   * Process a user message
   */
  async process(userMessage: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Agent is already processing a message');
    }

    if (!this.llmClient || !this.config) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }

    this.isRunning = true;
    this.shouldStop = false;

    try {
      // Run UserPromptSubmit hooks
      const promptHookResult = await this.hookExecutor.execute(
        this.hookLoader.getHooks('UserPromptSubmit'),
        {
          session_id: this.sessionId,
          hook_event_name: 'UserPromptSubmit',
          cwd: this.cwd,
          prompt: userMessage,
        }
      );

      if (promptHookResult?.continue === false) {
        this.emit({ type: 'error', error: promptHookResult.stopReason || 'Blocked by hook' });
        return;
      }

      // Check for slash command first (e.g., /help, /clear)
      if (userMessage.startsWith('/')) {
        const commandResult = await this.handleCommand(userMessage);
        if (commandResult.handled) {
          if (commandResult.clearConversation) {
            this.context = new AgentContext();
          }
          return;
        }
        // If command returned a prompt, use that instead
        if (commandResult.prompt) {
          userMessage = commandResult.prompt;
        }
      }

      // Check for skill invocation (e.g., /skill-name) - legacy support
      if (userMessage.startsWith('/')) {
        const handled = await this.handleSkillInvocation(userMessage);
        if (handled) return;
      }

      // Add user message to context
      this.context.addUserMessage(userMessage);

      // Run the agent loop
      await this.runLoop();
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Main agent loop - continues until no more tool calls
   */
  private async runLoop(): Promise<void> {
    const maxTurns = 50;
    let turn = 0;

    while (turn < maxTurns && !this.shouldStop) {
      turn++;

      const messages = this.context.getMessages();
      const tools = this.toolRegistry.getTools();

      let responseText = '';
      const toolCalls: ToolCall[] = [];

      // Stream response from LLM
      for await (const chunk of this.llmClient!.chat(messages, tools)) {
        if (this.shouldStop) break;

        this.emit(chunk);

        if (chunk.type === 'text' && chunk.content) {
          responseText += chunk.content;
        } else if (chunk.type === 'tool_use' && chunk.toolCall) {
          toolCalls.push(chunk.toolCall);
        } else if (chunk.type === 'error') {
          return;
        }
      }

      // Add assistant message
      this.context.addAssistantMessage(responseText, toolCalls.length > 0 ? toolCalls : undefined);

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      const results = await this.executeToolCalls(toolCalls);

      // Add tool results to context
      this.context.addToolResults(results);
    }

    // Run Stop hooks
    await this.hookExecutor.execute(this.hookLoader.getHooks('Stop'), {
      session_id: generateId(),
      hook_event_name: 'Stop',
      cwd: this.cwd,
    });

    this.emit({ type: 'done' });
  }

  /**
   * Execute tool calls with hooks
   */
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      // Run PreToolUse hooks
      const preHookResult = await this.hookExecutor.execute(
        this.hookLoader.getHooks('PreToolUse'),
        {
          session_id: generateId(),
          hook_event_name: 'PreToolUse',
          cwd: this.cwd,
          tool_name: toolCall.name,
          tool_input: toolCall.input,
        }
      );

      if (preHookResult?.permissionDecision === 'deny') {
        results.push({
          toolCallId: toolCall.id,
          content: `Tool call denied: ${preHookResult.stopReason || 'Blocked by hook'}`,
          isError: true,
        });
        continue;
      }

      // Emit tool start
      this.onToolStart?.(toolCall);

      // Execute the tool
      const result = await this.toolRegistry.execute(toolCall);

      // Emit tool end
      this.onToolEnd?.(toolCall, result);

      // Emit result as stream chunk
      this.emit({ type: 'tool_result', toolResult: result });

      // Run PostToolUse hooks
      await this.hookExecutor.execute(this.hookLoader.getHooks('PostToolUse'), {
        session_id: generateId(),
        hook_event_name: 'PostToolUse',
        cwd: this.cwd,
        tool_name: toolCall.name,
        tool_input: toolCall.input,
        tool_result: result.content,
      });

      results.push(result);
    }

    return results;
  }

  /**
   * Handle slash command
   */
  private async handleCommand(message: string): Promise<{ handled: boolean; prompt?: string; clearConversation?: boolean }> {
    const context: CommandContext = {
      cwd: this.cwd,
      sessionId: this.sessionId,
      messages: this.context.getMessages(),
      tools: this.toolRegistry.getTools(),
      clearMessages: () => {
        this.context = new AgentContext();
      },
      addSystemMessage: (content: string) => {
        this.context.addSystemMessage(content);
      },
      emit: (type: 'text' | 'done' | 'error', content?: string) => {
        if (type === 'text' && content) {
          this.emit({ type: 'text', content });
        } else if (type === 'done') {
          this.emit({ type: 'done' });
        } else if (type === 'error' && content) {
          this.emit({ type: 'error', error: content });
        }
      },
    };

    return this.commandExecutor.execute(message, context);
  }

  /**
   * Handle skill invocation
   */
  private async handleSkillInvocation(message: string): Promise<boolean> {
    const match = message.match(/^\/(\S+)(?:\s+(.*))?$/);
    if (!match) return false;

    const [, skillName, args] = match;
    const skill = this.skillLoader.getSkill(skillName);

    if (!skill) {
      // Not a skill, let the LLM handle it
      return false;
    }

    // Execute the skill
    const argsList = args ? args.split(/\s+/) : [];
    const content = await this.skillExecutor.prepare(skill, argsList);

    // Add skill content as context
    this.context.addSystemMessage(content);
    this.context.addUserMessage(`Execute the "${skillName}" skill with arguments: ${args || '(none)'}`);

    await this.runLoop();
    return true;
  }

  /**
   * Emit a stream chunk
   */
  private emit(chunk: StreamChunk): void {
    this.onChunk?.(chunk);
  }

  /**
   * Stop the current processing
   */
  stop(): void {
    this.shouldStop = true;
  }

  /**
   * Get the current context
   */
  getContext(): AgentContext {
    return this.context;
  }

  /**
   * Get all available tools
   */
  getTools(): Tool[] {
    return this.toolRegistry.getTools();
  }

  /**
   * Get all loaded skills
   */
  getSkills() {
    return this.skillLoader.getSkills();
  }

  /**
   * Get all loaded commands
   */
  getCommands() {
    return this.commandLoader.getCommands();
  }

  /**
   * Get current token usage
   */
  getTokenUsage(): TokenUsage {
    return this.builtinCommands.getTokenUsage();
  }

  /**
   * Update token usage (called by LLM client)
   */
  updateTokenUsage(usage: Partial<TokenUsage>): void {
    this.builtinCommands.updateTokenUsage(usage);
    this.onTokenUsage?.(this.builtinCommands.getTokenUsage());
  }

  /**
   * Check if agent is currently running
   */
  isProcessing(): boolean {
    return this.isRunning;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Clear conversation
   */
  clearConversation(): void {
    this.context = new AgentContext();
  }
}

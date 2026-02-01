import type { Message, Tool, StreamChunk, ToolCall, ToolResult, OldpalConfig, ScheduledCommand } from '@oldpal/shared';
import { generateId } from '@oldpal/shared';
import { AgentContext } from './context';
import { ToolRegistry } from '../tools/registry';
import { ConnectorBridge } from '../tools/connector';
import { BashTool } from '../tools/bash';
import { FilesystemTools } from '../tools/filesystem';
import { WebTools } from '../tools/web';
import { FeedbackTool } from '../tools/feedback';
import { SchedulerTool } from '../tools/scheduler';
import { ImageTools } from '../tools/image';
import { runHookAgent } from './subagent';
import { SkillLoader } from '../skills/loader';
import { SkillExecutor } from '../skills/executor';
import { HookLoader } from '../hooks/loader';
import { HookExecutor } from '../hooks/executor';
import { CommandLoader, CommandExecutor, BuiltinCommands, type TokenUsage, type CommandContext } from '../commands';
import { createLLMClient, type LLMClient } from '../llm/client';
import { loadConfig, loadHooksConfig, loadSystemPrompt, ensureConfigDir } from '../config';
import {
  acquireScheduleLock,
  DEFAULT_LOCK_TTL_MS,
  getDueSchedules,
  computeNextRun,
  readSchedule,
  refreshScheduleLock,
  releaseScheduleLock,
  updateSchedule,
} from '../scheduler/store';

export interface AgentLoopOptions {
  config?: OldpalConfig;
  cwd?: string;
  sessionId?: string;
  allowedTools?: string[];
  extraSystemPrompt?: string;
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
  private allowedTools: Set<string> | null = null;
  private currentAllowedTools: Set<string> | null = null;
  private extraSystemPrompt: string | null = null;
  private cwd: string;
  private sessionId: string;
  private isRunning = false;
  private shouldStop = false;
  private systemPrompt: string | null = null;
  private connectorDiscovery: Promise<unknown> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private scheduledQueue: ScheduledCommand[] = [];
  private drainingScheduled = false;

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
    this.allowedTools = this.normalizeAllowedTools(options.allowedTools);
    this.extraSystemPrompt = options.extraSystemPrompt || null;

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
      ensureConfigDir(this.sessionId),
    ]);
    this.config = config;

    const connectorNames =
      this.config.connectors && this.config.connectors.length > 0 && !this.config.connectors.includes('*')
        ? this.config.connectors
        : undefined;

    // Fast discovery (PATH scan only) so connector tools are available immediately.
    this.connectorBridge.fastDiscover(connectorNames);

    // Start connector discovery in the background so chat can start immediately.
    this.connectorDiscovery = this.connectorBridge.discover(connectorNames)
      .then(() => {
        this.connectorBridge.registerAll(this.toolRegistry);
      })
      .catch(() => {});

    // Phase 2: All independent async operations in parallel (excluding connectors)
    const [, , hooksConfig, systemPrompt] = await Promise.all([
      // Initialize LLM client
      createLLMClient(this.config.llm).then((client) => {
        this.llmClient = client;
        this.hookExecutor.setLLMClient(client);
      }),
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
    FilesystemTools.registerAll(this.toolRegistry, this.sessionId);
    WebTools.registerAll(this.toolRegistry);
    ImageTools.registerAll(this.toolRegistry);
    this.toolRegistry.register(FeedbackTool.tool, FeedbackTool.executor);
    this.toolRegistry.register(SchedulerTool.tool, SchedulerTool.executor);

    // Register connector tools
    this.connectorBridge.registerAll(this.toolRegistry);

    // Register builtin commands
    this.builtinCommands.registerAll(this.commandLoader);

    // Load hooks
    this.hookLoader.load(hooksConfig);

    this.hookExecutor.setAgentRunner((hook, input, timeout) =>
      runHookAgent({ hook, input, timeout, cwd: this.cwd })
    );

    // Set system prompt (store for re-use on clear)
    this.systemPrompt = systemPrompt || null;
    if (this.systemPrompt) {
      this.context.addSystemMessage(this.systemPrompt);
    }
    if (this.extraSystemPrompt) {
      this.context.addSystemMessage(this.extraSystemPrompt);
    }

    // Run session start hooks
    await this.hookExecutor.execute(this.hookLoader.getHooks('SessionStart'), {
      session_id: this.sessionId,
      hook_event_name: 'SessionStart',
      cwd: this.cwd,
    });

    this.startHeartbeat();
  }

  /**
   * Process a user message
   */
  async process(userMessage: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Agent is already processing a message');
    }
    await this.runMessage(userMessage, 'user');
  }

  private async runMessage(
    userMessage: string,
    source: 'user' | 'schedule'
  ): Promise<{ ok: boolean; summary?: string; error?: string }> {
    if (!this.llmClient || !this.config) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }

    this.isRunning = true;
    this.shouldStop = false;
    const beforeCount = this.context.getMessages().length;

    try {
      if (source === 'user') {
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
          return { ok: false, error: promptHookResult.stopReason || 'Blocked by hook' };
        }
      }

      if (userMessage.startsWith('/')) {
        const parsed = this.commandExecutor.parseCommand(userMessage);
        const command = parsed ? this.commandLoader.getCommand(parsed.name) : undefined;
        const skill = parsed ? this.skillLoader.getSkill(parsed.name) : undefined;

        if (command) {
          const commandResult = await this.handleCommand(userMessage);
          if (commandResult.handled) {
            if (commandResult.clearConversation) {
              this.resetContext();
            }
            if (commandResult.exit) {
              this.emit({ type: 'exit' });
            }
            return { ok: true, summary: `Handled ${userMessage}` };
          }
          if (commandResult.prompt) {
            userMessage = commandResult.prompt;
          }
        } else if (skill) {
          const handled = await this.handleSkillInvocation(userMessage);
          if (handled) return { ok: true, summary: `Executed ${userMessage}` };
        } else {
          const commandResult = await this.handleCommand(userMessage);
          if (commandResult.handled) {
            return { ok: true, summary: `Handled ${userMessage}` };
          }
          if (commandResult.prompt) {
            userMessage = commandResult.prompt;
          }
        }
      }

      this.context.addUserMessage(userMessage);
      await this.runLoop();

      const messages = this.context.getMessages().slice(beforeCount);
      const lastAssistant = [...messages].reverse().find((msg) => msg.role === 'assistant');
      const summary = lastAssistant?.content?.trim();
      return { ok: true, summary: summary ? summary.slice(0, 200) : undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    } finally {
      this.currentAllowedTools = null;
      this.isRunning = false;
      this.drainScheduledQueue();
    }
  }

  /**
   * Main agent loop - continues until no more tool calls
   */
  private async runLoop(): Promise<void> {
    const maxTurns = 50;
    let turn = 0;
    let streamError: Error | null = null;

    try {
      while (turn < maxTurns && !this.shouldStop) {
        turn++;

        const messages = this.context.getMessages();
        const tools = this.filterAllowedTools(this.toolRegistry.getTools());
        const systemPrompt = this.buildSystemPrompt(messages);

        let responseText = '';
        const toolCalls: ToolCall[] = [];

        // Stream response from LLM
        for await (const chunk of this.llmClient!.chat(messages, tools, systemPrompt)) {
          if (this.shouldStop) break;

          this.emit(chunk);

          if (chunk.type === 'text' && chunk.content) {
            responseText += chunk.content;
          } else if (chunk.type === 'tool_use' && chunk.toolCall) {
            toolCalls.push(chunk.toolCall);
          } else if (chunk.type === 'usage' && chunk.usage) {
            // Update token usage
            this.updateTokenUsage(chunk.usage);
          } else if (chunk.type === 'error') {
            streamError = new Error(chunk.error || 'LLM stream error');
            break;
          }
        }

        // Add assistant message if any content/tool calls
        const shouldStopNow = this.shouldStop || streamError !== null;
        if (responseText.trim() || toolCalls.length > 0) {
          this.context.addAssistantMessage(responseText, toolCalls.length > 0 ? toolCalls : undefined);
        }

        // If stopped or error mid-stream, don't execute tool calls
        if (shouldStopNow) {
          break;
        }

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          break;
        }

        // Execute tool calls
        const results = await this.executeToolCalls(toolCalls);

        // Add tool results to context
        this.context.addToolResults(results);
      }
    } finally {
      // Run Stop hooks
      await this.hookExecutor.execute(this.hookLoader.getHooks('Stop'), {
        session_id: this.sessionId,
        hook_event_name: 'Stop',
        cwd: this.cwd,
      });

      this.emit({ type: 'done' });
    }

    if (streamError) {
      throw streamError;
    }
  }

  /**
   * Execute tool calls with hooks
   */
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      // Ensure tools receive the agent's cwd by default
      const toolInput = { ...(toolCall.input || {}) } as Record<string, unknown>;
      if (toolInput.cwd === undefined) {
        toolInput.cwd = this.cwd;
      }
      toolCall.input = toolInput;

      if (!this.isToolAllowed(toolCall.name)) {
        const blockedResult: ToolResult = {
          toolCallId: toolCall.id,
          content: `Tool call denied: "${toolCall.name}" is not in the allowed tools list`,
          isError: true,
        };
        this.emit({ type: 'tool_result', toolResult: blockedResult });
        await this.hookExecutor.execute(this.hookLoader.getHooks('PostToolUseFailure'), {
          session_id: this.sessionId,
          hook_event_name: 'PostToolUseFailure',
          cwd: this.cwd,
          tool_name: toolCall.name,
          tool_input: toolCall.input,
          tool_result: blockedResult.content,
        });
        results.push(blockedResult);
        continue;
      }

      // Run PreToolUse hooks
      const preHookResult = await this.hookExecutor.execute(
        this.hookLoader.getHooks('PreToolUse'),
        {
          session_id: this.sessionId,
          hook_event_name: 'PreToolUse',
          cwd: this.cwd,
          tool_name: toolCall.name,
          tool_input: toolCall.input,
        }
      );

      // Apply updated input from hook if provided
      if (preHookResult?.updatedInput) {
        toolCall.input = { ...preHookResult.updatedInput };
        if ((toolCall.input as Record<string, unknown>).cwd === undefined) {
          (toolCall.input as Record<string, unknown>).cwd = this.cwd;
        }
      }

      // Check if hook blocked the tool (either via continue: false or permissionDecision: deny)
      if (preHookResult?.continue === false || preHookResult?.permissionDecision === 'deny') {
        const blockedResult: ToolResult = {
          toolCallId: toolCall.id,
          content: `Tool call denied: ${preHookResult.stopReason || 'Blocked by hook'}`,
          isError: true,
          toolName: toolCall.name,
        };
        this.emit({ type: 'tool_result', toolResult: blockedResult });
        await this.hookExecutor.execute(this.hookLoader.getHooks('PostToolUseFailure'), {
          session_id: this.sessionId,
          hook_event_name: 'PostToolUseFailure',
          cwd: this.cwd,
          tool_name: toolCall.name,
          tool_input: toolCall.input,
          tool_result: blockedResult.content,
        });
        results.push(blockedResult);
        continue;
      }

      if (preHookResult?.permissionDecision === 'ask') {
        const askResult: ToolResult = {
          toolCallId: toolCall.id,
          content: `Tool call requires approval: ${preHookResult.stopReason || 'Approval required'}`,
          isError: true,
          toolName: toolCall.name,
        };
        this.emit({ type: 'tool_result', toolResult: askResult });
        await this.hookExecutor.execute(this.hookLoader.getHooks('PostToolUseFailure'), {
          session_id: this.sessionId,
          hook_event_name: 'PostToolUseFailure',
          cwd: this.cwd,
          tool_name: toolCall.name,
          tool_input: toolCall.input,
          tool_result: askResult.content,
        });
        results.push(askResult);
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

      // Run PostToolUse or PostToolUseFailure hooks based on result
      const hookEvent = result.isError ? 'PostToolUseFailure' : 'PostToolUse';
      await this.hookExecutor.execute(this.hookLoader.getHooks(hookEvent), {
        session_id: this.sessionId,
        hook_event_name: hookEvent,
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
  private async handleCommand(message: string): Promise<{ handled: boolean; prompt?: string; clearConversation?: boolean; exit?: boolean }> {
    const parsed = this.commandExecutor.parseCommand(message);
    const command = parsed ? this.commandLoader.getCommand(parsed.name) : undefined;
    if (parsed?.name === 'connectors' && this.connectorDiscovery) {
      try {
        await this.connectorDiscovery;
      } catch {
        // Ignore discovery errors; command will handle empty state.
      }
    }
    const context: CommandContext = {
      cwd: this.cwd,
      sessionId: this.sessionId,
      messages: this.context.getMessages(),
      tools: this.toolRegistry.getTools(),
      skills: this.skillLoader.getSkills().map(s => ({
        name: s.name,
        description: s.description || '',
        argumentHint: s.argumentHint,
      })),
      connectors: this.connectorBridge.getConnectors().map(c => ({
        name: c.name,
        description: c.description,
        cli: c.cli,
        commands: c.commands.map(cmd => ({
          name: cmd.name,
          description: cmd.description,
        })),
      })),
      clearMessages: () => {
        this.resetContext();
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

    const result = await this.commandExecutor.execute(message, context);

    if (!result.handled && result.prompt) {
      this.currentAllowedTools = this.normalizeAllowedTools(command?.allowedTools);
    }

    return result;
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
    this.currentAllowedTools = this.normalizeAllowedTools(skill.allowedTools);
    this.context.addSystemMessage(content);
    this.context.addUserMessage(`Execute the "${skillName}" skill with arguments: ${args || '(none)'}`);

    try {
      await this.runLoop();
    } finally {
      this.currentAllowedTools = null;
    }
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
    this.resetContext();
  }

  private startHeartbeat(): void {
    if (!this.config?.scheduler?.enabled) return;
    const interval = this.config.scheduler?.heartbeatIntervalMs ?? 30000;
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.tickHeartbeat();
    }, interval);
    if (typeof (this.heartbeatTimer as any).unref === 'function') {
      (this.heartbeatTimer as any).unref();
    }
  }

  private async tickHeartbeat(): Promise<void> {
    try {
      const now = Date.now();
      const due = await getDueSchedules(this.cwd, now);
      for (const schedule of due) {
        const locked = await acquireScheduleLock(this.cwd, schedule.id, this.sessionId);
        if (!locked) continue;
        const alreadyQueued = this.scheduledQueue.some((item) => item.id === schedule.id);
        if (alreadyQueued) {
          await releaseScheduleLock(this.cwd, schedule.id, this.sessionId);
          continue;
        }
        this.scheduledQueue.push(schedule);
      }
      this.drainScheduledQueue();
    } catch (error) {
      console.error('Scheduler heartbeat error:', error);
    }
  }

  private async drainScheduledQueue(): Promise<void> {
    if (this.drainingScheduled) return;
    if (this.isRunning) return;
    if (this.scheduledQueue.length === 0) return;

    this.drainingScheduled = true;
    try {
      while (this.scheduledQueue.length > 0 && !this.isRunning) {
        const schedule = this.scheduledQueue.shift();
        if (!schedule) break;

        const current = await readSchedule(this.cwd, schedule.id);
        if (!current || current.status !== 'active' || !current.nextRunAt || current.nextRunAt > Date.now()) {
          await releaseScheduleLock(this.cwd, schedule.id, this.sessionId);
          continue;
        }

        const leaseInterval = Math.max(10000, Math.floor(DEFAULT_LOCK_TTL_MS / 2));
        const leaseTimer = setInterval(() => {
          refreshScheduleLock(this.cwd, schedule.id, this.sessionId);
        }, leaseInterval);
        if (typeof (leaseTimer as any).unref === 'function') {
          (leaseTimer as any).unref();
        }

        try {
          const result = await this.runMessage(current.command, 'schedule');
          const now = Date.now();
          await updateSchedule(this.cwd, schedule.id, (live) => {
            const updated: ScheduledCommand = {
              ...live,
              updatedAt: now,
              lastRunAt: now,
              lastResult: {
                ok: result.ok,
                summary: result.summary,
                error: result.error,
              },
            };

            if (live.schedule.kind === 'once') {
              updated.status = result.ok ? 'completed' : 'error';
              updated.nextRunAt = undefined;
            } else {
              updated.status = live.status === 'paused' ? 'paused' : 'active';
              updated.nextRunAt = computeNextRun(updated, now);
            }
            return updated;
          });
        } finally {
          clearInterval(leaseTimer);
          await releaseScheduleLock(this.cwd, schedule.id, this.sessionId);
        }
      }
    } finally {
      this.drainingScheduled = false;
    }
  }

  /**
   * Reset context and re-apply system prompt
   */
  private resetContext(): void {
    this.context = new AgentContext();
    if (this.systemPrompt) {
      this.context.addSystemMessage(this.systemPrompt);
    }
    if (this.extraSystemPrompt) {
      this.context.addSystemMessage(this.extraSystemPrompt);
    }
  }

  /**
   * Build system prompt from base + extra + system messages in context
   */
  private buildSystemPrompt(messages: Message[]): string | undefined {
    const parts: string[] = [];

    if (this.systemPrompt) {
      parts.push(this.systemPrompt);
    }
    if (this.extraSystemPrompt) {
      parts.push(this.extraSystemPrompt);
    }

    for (const msg of messages) {
      if (msg.role !== 'system') continue;
      const content = msg.content.trim();
      if (!content) continue;
      if (parts.includes(content)) continue;
      parts.push(content);
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined;
  }

  /**
   * Normalize tool names to a canonical set (case-insensitive with aliases)
   */
  private normalizeAllowedTools(tools?: string[]): Set<string> | null {
    if (!tools || tools.length === 0) return null;

    const aliases: Record<string, string[]> = {
      read: ['read'],
      edit: ['write'],
      write: ['write'],
      bash: ['bash'],
      search: ['web_search'],
      web_search: ['web_search'],
      fetch: ['web_fetch', 'curl'],
      web_fetch: ['web_fetch'],
      curl: ['curl'],
      image: ['display_image'],
      display_image: ['display_image'],
    };

    const normalized = new Set<string>();
    for (const raw of tools) {
      const key = raw.trim().toLowerCase();
      if (!key) continue;
      const mapped = aliases[key];
      if (mapped) {
        for (const name of mapped) normalized.add(name);
      } else {
        normalized.add(key);
      }
    }

    return normalized.size > 0 ? normalized : null;
  }

  /**
   * Compute the effective allowed tools for this run
   */
  private getEffectiveAllowedTools(): Set<string> | null {
    if (this.allowedTools && this.currentAllowedTools) {
      const intersection = new Set<string>();
      for (const name of this.currentAllowedTools) {
        if (this.allowedTools.has(name)) {
          intersection.add(name);
        }
      }
      return intersection;
    }
    return this.currentAllowedTools || this.allowedTools;
  }

  private filterAllowedTools(tools: Tool[]): Tool[] {
    const allowed = this.getEffectiveAllowedTools();
    if (!allowed) return tools;
    return tools.filter((tool) => allowed.has(tool.name.toLowerCase()));
  }

  private isToolAllowed(name: string): boolean {
    const allowed = this.getEffectiveAllowedTools();
    if (!allowed) return true;
    return allowed.has(name.toLowerCase());
  }
}

import type { Message, Tool, StreamChunk, ToolCall, ToolResult, AssistantsConfig, ScheduledCommand, VoiceState, ActiveIdentityInfo } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import { join } from 'path';
import { AgentContext } from './context';
import {
  ContextManager,
  HybridSummarizer,
  LLMSummarizer,
  TokenCounter,
  type ContextConfig,
  type ContextInfo,
} from '../context';
import { ToolRegistry } from '../tools/registry';
import { ConnectorBridge } from '../tools/connector';
import { BashTool } from '../tools/bash';
import { FilesystemTools } from '../tools/filesystem';
import { WebTools } from '../tools/web';
import { FeedbackTool } from '../tools/feedback';
import { SchedulerTool } from '../tools/scheduler';
import { ImageTools } from '../tools/image';
import { SkillTool, createSkillListTool, createSkillReadTool } from '../tools/skills';
import { createAskUserTool, type AskUserHandler } from '../tools/ask-user';
import { WaitTool, SleepTool } from '../tools/wait';
import { runHookAgent } from './subagent';
import { SkillLoader } from '../skills/loader';
import { SkillExecutor } from '../skills/executor';
import {
  HookLoader,
  HookExecutor,
  nativeHookRegistry,
  ScopeContextManager,
  createScopeVerificationHook,
} from '../hooks';
import { CommandLoader, CommandExecutor, BuiltinCommands, type TokenUsage, type CommandContext } from '../commands';
import { createLLMClient, type LLMClient } from '../llm/client';
import { loadConfig, loadHooksConfig, loadSystemPrompt, ensureConfigDir, getConfigDir } from '../config';
import {
  HeartbeatManager,
  StatePersistence,
  RecoveryManager,
  type AgentState,
  type Heartbeat,
  type HeartbeatConfig as HeartbeatRuntimeConfig,
} from '../heartbeat';
import { EnergyManager, EnergyStorage, applyPersonality, type EnergyEffects, type EnergyState } from '../energy';
import { AssistantError, ErrorAggregator, ErrorCodes, type ErrorCode } from '../errors';
import { configureLimits, enforceMessageLimit, getLimits } from '../validation/limits';
import { validateToolCalls } from '../validation/llm-response';
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
import { VoiceManager } from '../voice/manager';
import { AssistantManager, IdentityManager } from '../identity';
import { createInboxManager, registerInboxTools, type InboxManager } from '../inbox';
import { createWalletManager, registerWalletTools, type WalletManager } from '../wallet';
import { createSecretsManager, registerSecretsTools, type SecretsManager } from '../secrets';
import { JobManager, createJobTools } from '../jobs';
import { createMessagesManager, registerMessagesTools, type MessagesManager } from '../messages';

export interface AgentLoopOptions {
  config?: AssistantsConfig;
  cwd?: string;
  sessionId?: string;
  assistantId?: string;
  allowedTools?: string[];
  extraSystemPrompt?: string;
  llmClient?: LLMClient;
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
  private contextManager: ContextManager | null = null;
  private contextConfig: ContextConfig | null = null;
  private heartbeatManager: HeartbeatManager | null = null;
  private heartbeatPersistence: StatePersistence | null = null;
  private heartbeatRecovery: RecoveryManager | null = null;
  private lastUserMessage: string | null = null;
  private lastToolName: string | null = null;
  private pendingToolCalls: Map<string, string> = new Map();
  private energyManager: EnergyManager | null = null;
  private energyEffects: EnergyEffects | null = null;
  private lastEnergyLevel: EnergyEffects['level'] | null = null;
  private toolRegistry: ToolRegistry;
  private connectorBridge: ConnectorBridge;
  private skillLoader: SkillLoader;
  private skillExecutor: SkillExecutor;
  private hookLoader: HookLoader;
  private hookExecutor: HookExecutor;
  private scopeContextManager: ScopeContextManager;
  private commandLoader: CommandLoader;
  private commandExecutor: CommandExecutor;
  private builtinCommands: BuiltinCommands;
  private llmClient: LLMClient | null = null;
  private config: AssistantsConfig | null = null;
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
  private errorAggregator = new ErrorAggregator();
  private voiceManager: VoiceManager | null = null;
  private assistantManager: AssistantManager | null = null;
  private identityManager: IdentityManager | null = null;
  private inboxManager: InboxManager | null = null;
  private walletManager: WalletManager | null = null;
  private secretsManager: SecretsManager | null = null;
  private jobManager: JobManager | null = null;
  private messagesManager: MessagesManager | null = null;
  private pendingMessagesContext: string | null = null;
  private identityContext: string | null = null;
  private projectContext: string | null = null;
  private activeProjectId: string | null = null;
  private assistantId: string | null = null;
  private askUserHandler: AskUserHandler | null = null;

  // Event callbacks
  private onChunk?: (chunk: StreamChunk) => void;
  private onToolStart?: (toolCall: ToolCall) => void;
  private onToolEnd?: (toolCall: ToolCall, result: ToolResult) => void;
  private onTokenUsage?: (usage: TokenUsage) => void;

  constructor(options: AgentLoopOptions = {}) {
    this.cwd = options.cwd || process.cwd();
    this.sessionId = options.sessionId || generateId();
    this.assistantId = options.assistantId || null;
    this.context = new AgentContext();
    this.toolRegistry = new ToolRegistry();
    this.toolRegistry.setErrorAggregator(this.errorAggregator);
    this.connectorBridge = new ConnectorBridge(this.cwd);
    this.skillLoader = new SkillLoader();
    this.skillExecutor = new SkillExecutor();
    this.hookLoader = new HookLoader();
    this.hookExecutor = new HookExecutor();
    this.scopeContextManager = new ScopeContextManager();
    this.commandLoader = new CommandLoader(this.cwd);
    this.commandExecutor = new CommandExecutor(this.commandLoader);
    this.builtinCommands = new BuiltinCommands();
    this.allowedTools = this.normalizeAllowedTools(options.allowedTools);
    this.extraSystemPrompt = options.extraSystemPrompt || null;
    this.llmClient = options.llmClient ?? null;

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
    configureLimits(this.config.validation);
    this.toolRegistry.setValidationConfig(this.config.validation);
    this.contextConfig = this.buildContextConfig(this.config);
    this.context.setMaxMessages(this.contextConfig.maxMessages);
    this.builtinCommands.updateTokenUsage({ maxContextTokens: this.contextConfig.maxContextTokens });
    if (this.config.voice) {
      this.voiceManager = new VoiceManager(this.config.voice);
    }
    await this.initializeIdentitySystem();

    const connectorNames =
      this.config.connectors && this.config.connectors.length > 0 && !this.config.connectors.includes('*')
        ? this.config.connectors
        : undefined;

    // Fast discovery (PATH scan only) so connector tools are available immediately.
    this.connectorBridge.fastDiscover(connectorNames);
    this.connectorBridge.registerAll(this.toolRegistry);

    // Start connector discovery in the background so chat can start immediately.
    this.connectorDiscovery = this.connectorBridge.discover(connectorNames)
      .then(() => {
        this.connectorBridge.registerAll(this.toolRegistry);
      })
      .catch(() => {});

    // Phase 2: All independent async operations in parallel (excluding connectors)
    const llmClientPromise = this.llmClient
      ? Promise.resolve(this.llmClient).then((client) => {
          this.hookExecutor.setLLMClient(client);
          return client;
        })
      : createLLMClient(this.config.llm).then((client) => {
          this.llmClient = client;
          this.hookExecutor.setLLMClient(client);
          return client;
        });

    const [, , hooksConfig, systemPrompt] = await Promise.all([
      llmClientPromise,
      // Load skills metadata (descriptions only)
      this.skillLoader.loadAll(this.cwd, { includeContent: false }),
      // Load hooks config
      loadHooksConfig(this.cwd),
      // Load system prompt
      loadSystemPrompt(this.cwd),
      // Load commands
      this.commandLoader.loadAll(),
    ]);

    if (this.llmClient && this.contextConfig) {
      const summaryClient = await this.buildSummaryClient(this.contextConfig);
      const tokenCounter = new TokenCounter(this.llmClient.getModel());
      const llmSummarizer = new LLMSummarizer(summaryClient, {
        maxTokens: this.contextConfig.summaryMaxTokens,
        tokenCounter,
      });
      const summarizer =
        this.contextConfig.summaryStrategy === 'hybrid'
          ? new HybridSummarizer(llmSummarizer)
          : llmSummarizer;
      this.contextManager = new ContextManager(this.contextConfig, summarizer, tokenCounter);
    }

    // Phase 3: Sync operations (fast)
    // Register built-in tools
    this.toolRegistry.register(BashTool.tool, BashTool.executor);
    FilesystemTools.registerAll(this.toolRegistry, this.sessionId);
    WebTools.registerAll(this.toolRegistry);
    ImageTools.registerAll(this.toolRegistry);
    this.toolRegistry.register(SkillTool.tool, SkillTool.executor);
    const skillListTool = createSkillListTool(() => this.skillLoader);
    this.toolRegistry.register(skillListTool.tool, skillListTool.executor);
    const skillReadTool = createSkillReadTool(() => this.skillLoader);
    this.toolRegistry.register(skillReadTool.tool, skillReadTool.executor);
    const askUserTool = createAskUserTool(() => this.askUserHandler);
    this.toolRegistry.register(askUserTool.tool, askUserTool.executor);
    this.toolRegistry.register(FeedbackTool.tool, FeedbackTool.executor);
    this.toolRegistry.register(SchedulerTool.tool, SchedulerTool.executor);
    this.toolRegistry.register(WaitTool.tool, WaitTool.executor);
    this.toolRegistry.register(SleepTool.tool, SleepTool.executor);

    // Initialize inbox if enabled
    if (this.config?.inbox?.enabled) {
      const assistant = this.assistantManager?.getActive();
      const agentId = assistant?.id || this.sessionId;
      const agentName = assistant?.name || 'assistant';
      this.inboxManager = createInboxManager(
        agentId,
        agentName,
        this.config.inbox,
        getConfigDir()
      );
      registerInboxTools(this.toolRegistry, () => this.inboxManager);
    }

    // Initialize wallet if enabled
    if (this.config?.wallet?.enabled) {
      const assistant = this.assistantManager?.getActive();
      const agentId = assistant?.id || this.sessionId;
      this.walletManager = createWalletManager(agentId, this.config.wallet);
      registerWalletTools(this.toolRegistry, () => this.walletManager);
    }

    // Initialize secrets if enabled
    if (this.config?.secrets?.enabled) {
      const assistant = this.assistantManager?.getActive();
      const agentId = assistant?.id || this.sessionId;
      this.secretsManager = createSecretsManager(agentId, this.config.secrets);
      registerSecretsTools(this.toolRegistry, () => this.secretsManager);
    }

    // Initialize messages if enabled
    if (this.config?.messages?.enabled) {
      const assistant = this.assistantManager?.getActive();
      const agentId = assistant?.id || this.sessionId;
      const agentName = assistant?.name || 'assistant';
      this.messagesManager = createMessagesManager(agentId, agentName, this.config.messages);
      await this.messagesManager.initialize();
      registerMessagesTools(this.toolRegistry, () => this.messagesManager);
    }

    // Initialize jobs system if enabled
    if (this.config?.jobs?.enabled !== false) {
      this.jobManager = new JobManager(this.config?.jobs || {}, this.sessionId);

      // Set up job completion notifications
      this.jobManager.onJobComplete((event) => {
        // Notify via stream chunk
        const statusEmoji = event.status === 'completed' ? '✓' : event.status === 'failed' ? '✗' : '⚠';
        const message = `\n[Job ${event.status}] ${event.connector} (${event.jobId}): ${event.summary}\n`;
        this.emit({ type: 'text', content: message });
      });

      // Register job tools
      const jobTools = createJobTools(() => this.jobManager);
      for (const { tool, executor } of jobTools) {
        this.toolRegistry.register(tool, executor);
      }

      // Connect job manager to connector bridge
      this.connectorBridge.setJobManagerGetter(() => this.jobManager);

      // Clean up old jobs on startup
      this.jobManager.cleanup().catch(() => {});
    }

    // Register connector tools
    this.connectorBridge.registerAll(this.toolRegistry);

    // Register builtin commands
    this.builtinCommands.registerAll(this.commandLoader);

    // Load hooks
    this.hookLoader.load(hooksConfig);

    // Register native hooks
    nativeHookRegistry.register(createScopeVerificationHook());

    // Configure scope verification from hooks config
    const nativeConfig = (hooksConfig as any)?.native;
    if (nativeConfig) {
      nativeHookRegistry.setConfig(nativeConfig);
      if (nativeConfig.scopeVerification) {
        this.scopeContextManager.setConfig(nativeConfig.scopeVerification);
      }
    }

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
    this.contextManager?.refreshState(this.context.getMessages());

    // Run session start hooks
    await this.hookExecutor.execute(this.hookLoader.getHooks('SessionStart'), {
      session_id: this.sessionId,
      hook_event_name: 'SessionStart',
      cwd: this.cwd,
    });

    this.startHeartbeat();
    this.startAgentHeartbeat();
    await this.startEnergySystem();
  }

  /**
   * Process a user message
   */
  async process(userMessage: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Agent is already processing a message');
    }

    // Inject pending messages before processing
    await this.injectPendingMessages();

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
    this.setHeartbeatState('processing');
    this.shouldStop = false;
    const beforeCount = this.context.getMessages().length;
    this.lastUserMessage = userMessage;
    this.recordHeartbeatActivity('message');
    this.consumeEnergy('message');

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

      const explicitToolResult = await this.handleExplicitToolCommand(userMessage);
      if (explicitToolResult) {
        return explicitToolResult;
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

      const limits = getLimits();
      userMessage = enforceMessageLimit(userMessage, limits.maxUserMessageLength);

      // Track scope context for goal verification (only for non-command messages)
      if (source === 'user') {
        const scopeContext = await this.scopeContextManager.createContext(
          userMessage,
          this.llmClient
        );
        if (scopeContext) {
          this.context.setScopeContext(scopeContext);
        }
      }

      this.context.addUserMessage(userMessage);
      await this.runLoop();
      this.contextManager?.refreshState(this.context.getMessages());

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
      this.setHeartbeatState('idle');
      await this.drainScheduledQueue();
    }
  }

  private async handleExplicitToolCommand(
    userMessage: string
  ): Promise<{ ok: boolean; summary?: string; error?: string } | null> {
    const match = userMessage.match(/^!\[(\w+)\]\s*([\s\S]*)$/);
    if (!match) return null;

    const toolName = match[1].toLowerCase();
    const command = match[2].trim();

    if (!command) {
      this.emit({ type: 'text', content: `Usage: ![${toolName}] <command>\n` });
      this.emit({ type: 'done' });
      return { ok: false, error: 'Missing command' };
    }

    if (toolName !== 'bash') {
      this.emit({ type: 'text', content: `Unsupported tool: ${toolName}\n` });
      this.emit({ type: 'done' });
      return { ok: false, error: 'Unsupported tool' };
    }

    const toolCall: ToolCall = {
      id: generateId(),
      name: 'bash',
      input: {
        command,
        cwd: this.cwd,
        sessionId: this.sessionId,
      },
    };

    this.context.addUserMessage(userMessage);
    this.context.addAssistantMessage('', [toolCall]);

    this.emit({ type: 'tool_use', toolCall });
    const results = await this.executeToolCalls([toolCall]);
    this.context.addToolResults(results);

    this.emit({ type: 'done' });
    const failed = results.some((result) => result.isError);
    if (failed) {
      const error = results.find((result) => result.isError)?.content;
      return { ok: false, error: error ? String(error) : 'Tool execution failed' };
    }
    return { ok: true, summary: `Executed ${toolName}` };
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

        await this.maybeSummarizeContext();

        const messages = this.context.getMessages();
        this.consumeEnergy('llmCall');
        if (this.contextConfig && this.contextManager) {
          const contextTokens = this.contextManager.getState().totalTokens;
          if (contextTokens > this.contextConfig.maxContextTokens * 0.8) {
            this.consumeEnergy('longContext');
          }
        }
        await this.applyEnergyDelay();

        const tools = this.filterAllowedTools(this.toolRegistry.getTools());
        const systemPrompt = this.applyEnergyPersonality(this.buildSystemPrompt(messages));

        let responseText = '';
        let toolCalls: ToolCall[] = [];

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
            this.recordLLMError(chunk.error);
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

        const validation = validateToolCalls(toolCalls, tools);
        if (validation.errors.length > 0) {
          for (const error of validation.errors) {
            this.errorAggregator.record(error);
          }
        }
        if (validation.validated.size > 0) {
          toolCalls = toolCalls.map((call) => validation.validated.get(call.id) ?? call);
        }

        // Execute tool calls
        const results = await this.executeToolCalls(toolCalls);

        // Add tool results to context
        this.context.addToolResults(results);
      }
    } finally {
      // Run user-defined Stop hooks
      await this.hookExecutor.execute(this.hookLoader.getHooks('Stop'), {
        session_id: this.sessionId,
        hook_event_name: 'Stop',
        cwd: this.cwd,
      });

      const shouldSkipVerification = this.shouldStop || streamError !== null;
      if (shouldSkipVerification) {
        this.scopeContextManager.clear();
        this.context.clearScopeContext();
        this.emit({ type: 'done' });
        return;
      }

      // Run native scope verification if enabled
      const verificationResult = await this.runScopeVerification();
      if (verificationResult && verificationResult.continue === false) {
        // Verification failed - force continuation
        if (verificationResult.systemMessage) {
          this.context.addSystemMessage(verificationResult.systemMessage);
        }
        // Increment attempts and re-run the loop
        this.scopeContextManager.incrementAttempts();
        const scope = this.scopeContextManager.getContext();
        if (scope) {
          this.context.setScopeContext(scope);
        }
        // Don't emit 'done' - re-enter the loop
        await this.runLoop();
        return;
      }

      // Clear scope context on successful completion
      this.scopeContextManager.clear();
      this.context.clearScopeContext();

      this.emit({ type: 'done' });
    }

    if (streamError) {
      throw streamError;
    }
  }

  private async maybeSummarizeContext(): Promise<void> {
    if (!this.contextManager) return;
    try {
      const result = await this.contextManager.processMessages(this.context.getMessages());
      if (!result.summarized) return;

      this.context.import(result.messages);
      const notice = `\n[Context summarized: ${result.summarizedCount} messages, ${result.tokensBefore.toLocaleString()} -> ${result.tokensAfter.toLocaleString()} tokens]\n`;
      this.emit({ type: 'text', content: notice });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorAggregator.record(new AssistantError(message, {
        code: ErrorCodes.LLM_API_ERROR,
        recoverable: true,
        retryable: false,
        userFacing: true,
      }));
      this.emit({ type: 'text', content: `\n[Context summarization failed: ${message}]\n` });
    }
  }

  /**
   * Run scope verification to check if goals were met
   */
  private async runScopeVerification(): Promise<{ continue: boolean; systemMessage?: string } | null> {
    // Skip if verification is disabled
    if (!this.scopeContextManager.isEnabled()) {
      return null;
    }

    // Skip if max attempts reached
    if (this.scopeContextManager.hasReachedMaxAttempts()) {
      return null;
    }

    const scopeContext = this.context.getScopeContext();
    if (!scopeContext) {
      return null;
    }

    // Run native verification hooks
    const result = await nativeHookRegistry.execute(
      'Stop',
      {
        session_id: this.sessionId,
        hook_event_name: 'Stop',
        cwd: this.cwd,
      },
      {
        sessionId: this.sessionId,
        cwd: this.cwd,
        messages: this.context.getMessages(),
        scopeContext,
        llmClient: this.llmClient,
      }
    );

    if (!result) {
      return null;
    }

    return {
      continue: result.continue !== false,
      systemMessage: result.systemMessage,
    };
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
      if (typeof toolInput.sessionId !== 'string' || toolInput.sessionId.length === 0) {
        toolInput.sessionId = this.sessionId;
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
      }

      const input = toolCall.input as Record<string, unknown>;
      if (input.cwd === undefined) {
        input.cwd = this.cwd;
      }
      if (typeof input.sessionId !== 'string' || input.sessionId.length === 0) {
        input.sessionId = this.sessionId;
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
      this.consumeEnergy('toolCall');
      this.recordHeartbeatActivity('tool');
      this.lastToolName = toolCall.name;
      this.pendingToolCalls.set(toolCall.id, toolCall.name);
      this.onToolStart?.(toolCall);

      // Execute the tool
      const result = await this.toolRegistry.execute(toolCall);

      // Emit tool end
      this.onToolEnd?.(toolCall, result);

      // Emit result as stream chunk
      this.emit({ type: 'tool_result', toolResult: result });

      // Run PostToolUse or PostToolUseFailure hooks based on result
      const hookEvent = result.isError ? 'PostToolUseFailure' : 'PostToolUse';
      if (result.isError) {
        this.recordHeartbeatActivity('error');
      }
      await this.hookExecutor.execute(this.hookLoader.getHooks(hookEvent), {
        session_id: this.sessionId,
        hook_event_name: hookEvent,
        cwd: this.cwd,
        tool_name: toolCall.name,
        tool_input: toolCall.input,
        tool_result: result.content,
      });

      results.push(result);

      this.pendingToolCalls.delete(toolCall.id);
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
      getContextInfo: () => this.getContextInfo(),
      getModel: () => this.llmClient?.getModel(),
      summarizeContext: async () => {
        if (!this.contextManager) {
          return {
            messages: this.context.getMessages(),
            summarized: false,
            summary: undefined,
            tokensBefore: 0,
            tokensAfter: 0,
            summarizedCount: 0,
          };
        }
        const result = await this.contextManager.summarizeNow(this.context.getMessages());
        if (result.summarized) {
          this.context.import(result.messages);
        }
        return result;
      },
      getEnergyState: () => this.getEnergyState(),
      getAssistantManager: () => this.assistantManager,
      getIdentityManager: () => this.identityManager,
      getInboxManager: () => this.inboxManager,
      getWalletManager: () => this.walletManager,
      getSecretsManager: () => this.secretsManager,
      getMessagesManager: () => this.messagesManager,
      refreshIdentityContext: async () => {
        if (this.identityManager) {
          this.identityContext = await this.identityManager.buildSystemPromptContext();
        }
      },
      refreshSkills: async () => {
        await this.skillLoader.loadAll(this.cwd, { includeContent: false });
      },
      switchAssistant: async (assistantId: string) => {
        await this.switchAssistant(assistantId);
      },
      switchIdentity: async (identityId: string) => {
        await this.switchIdentity(identityId);
      },
      getActiveProjectId: () => this.activeProjectId,
      setActiveProjectId: (projectId: string | null) => {
        this.activeProjectId = projectId;
      },
      setProjectContext: (content: string | null) => {
        this.setProjectContext(content);
      },
      getVoiceState: () => this.getVoiceState(),
      enableVoice: () => {
        if (!this.voiceManager) {
          throw new Error('Voice support is not available.');
        }
        this.voiceManager.enable();
      },
      disableVoice: () => {
        if (!this.voiceManager) {
          throw new Error('Voice support is not available.');
        }
        this.voiceManager.disable();
      },
      speak: async (text: string) => {
        if (!this.voiceManager) {
          throw new Error('Voice support is not available.');
        }
        await this.voiceManager.speak(text);
      },
      listen: async (options) => {
        if (!this.voiceManager) {
          throw new Error('Voice support is not available.');
        }
        return this.voiceManager.listen(options);
      },
      stopSpeaking: () => {
        this.voiceManager?.stopSpeaking();
      },
      stopListening: () => {
        this.voiceManager?.stopListening();
      },
      restEnergy: (amount?: number) => {
        if (this.energyManager) {
          this.energyManager.rest(amount);
          this.refreshEnergyEffects();
        }
      },
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
          this.recordLLMError(content);
          this.emit({ type: 'error', error: content });
        }
      },
      getErrorStats: () => this.errorAggregator.getStats(),
    };

    const result = await this.commandExecutor.execute(message, context);

    if (!result.handled && result.prompt) {
      this.currentAllowedTools = this.normalizeAllowedTools(command?.allowedTools);
    }

    return result;
  }

  private recordLLMError(message?: string): void {
    const text = message || 'LLM error';
    this.recordHeartbeatActivity('error');
    this.setHeartbeatState('error');
    const parsed = parseErrorCode(text);
    if (parsed) {
      this.errorAggregator.record(new AssistantError(parsed.message, {
        code: parsed.code,
        recoverable: true,
        retryable: false,
        userFacing: true,
      }));
      return;
    }
    this.errorAggregator.record(new AssistantError(text, {
      code: ErrorCodes.LLM_API_ERROR,
      recoverable: true,
      retryable: false,
      userFacing: true,
    }));
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
    const hydrated = await this.skillLoader.ensureSkillContent(skill.name);
    if (!hydrated) {
      this.context.addAssistantMessage(`Skill "${skillName}" could not be loaded.`);
      return true;
    }
    const content = await this.skillExecutor.prepare(hydrated, argsList);

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
    this.setHeartbeatState('stopped');
  }

  /**
   * Shutdown background systems and timers
   */
  shutdown(): void {
    this.shouldStop = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatManager?.stop();
    this.energyManager?.stop();
    this.voiceManager?.stopSpeaking();
    this.voiceManager?.stopListening();
  }

  /**
   * Get the current context
   */
  getContext(): AgentContext {
    return this.context;
  }

  /**
   * Get current voice state
   */
  getVoiceState(): VoiceState | null {
    return this.voiceManager?.getState() ?? null;
  }

  getAssistantId(): string | null {
    return this.assistantManager?.getActiveId() ?? null;
  }

  getIdentityInfo(): ActiveIdentityInfo {
    return {
      assistant: this.assistantManager?.getActive() ?? null,
      identity: this.identityManager?.getActive() ?? null,
    };
  }

  private async switchAssistant(assistantId: string): Promise<void> {
    if (!this.assistantManager) {
      throw new Error('Assistant manager not initialized');
    }
    await this.assistantManager.switchAssistant(assistantId);
    const active = this.assistantManager.getActive();
    if (!active) {
      this.identityManager = null;
      this.identityContext = null;
      return;
    }
    this.identityManager = this.assistantManager.getIdentityManager(active.id);
    await this.identityManager.initialize();
    if (this.identityManager.listIdentities().length === 0) {
      await this.identityManager.createIdentity({ name: 'Default' });
    }
    this.identityContext = await this.identityManager.buildSystemPromptContext();
  }

  private async switchIdentity(identityId: string): Promise<void> {
    if (!this.identityManager) {
      throw new Error('Identity manager not initialized');
    }
    await this.identityManager.switchIdentity(identityId);
    this.identityContext = await this.identityManager.buildSystemPromptContext();
  }

  /**
   * Replace context messages (used for session restore)
   */
  importContext(messages: Message[]): void {
    this.context.import(messages);
    this.contextManager?.refreshState(messages);
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
   * Get current LLM model
   */
  getModel(): string | null {
    return this.llmClient?.getModel() ?? this.config?.llm?.model ?? null;
  }

  /**
   * Get current context info
   */
  getContextInfo(): ContextInfo | null {
    if (!this.contextManager || !this.contextConfig) return null;
    return {
      config: this.contextConfig,
      state: this.contextManager.getState(),
    };
  }

  /**
   * Get current energy state
   */
  getEnergyState(): EnergyState | null {
    return this.energyManager ? this.energyManager.getState() : null;
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

  getActiveProjectId(): string | null {
    return this.activeProjectId;
  }

  setActiveProjectId(projectId: string | null): void {
    this.activeProjectId = projectId;
  }

  setProjectContext(content: string | null): void {
    const tag = '[Project Context]';
    this.projectContext = content;
    this.context.removeSystemMessages((message) => message.startsWith(tag));
    if (content && content.trim()) {
      this.context.addSystemMessage(`${tag}\n${content.trim()}`);
    }
    this.contextManager?.refreshState(this.context.getMessages());
  }

  setAskUserHandler(handler: AskUserHandler | null): void {
    this.askUserHandler = handler;
  }

  /**
   * Clear conversation
   */
  clearConversation(): void {
    this.resetContext();
  }

  private startAgentHeartbeat(): void {
    if (!this.config) return;
    if (this.config.heartbeat?.enabled === false) return;

    const heartbeatConfig = this.buildHeartbeatConfig(this.config);
    if (!heartbeatConfig) return;

    const statePath = join(getConfigDir(), 'state', `${this.sessionId}.json`);

    this.heartbeatManager = new HeartbeatManager(heartbeatConfig);
    this.heartbeatPersistence = new StatePersistence(statePath);
    this.heartbeatRecovery = new RecoveryManager(
      this.heartbeatPersistence,
      heartbeatConfig.persistPath,
      heartbeatConfig.staleThresholdMs,
      {
        autoResume: false,
        maxAgeMs: 24 * 60 * 60 * 1000,
      }
    );

    this.heartbeatManager.onHeartbeat((heartbeat) => {
      void this.persistHeartbeat(heartbeat);
    });

    this.heartbeatManager.start(this.sessionId);
    this.heartbeatManager.setState('idle');
    void this.checkRecovery();
  }

  private async persistHeartbeat(heartbeat: Heartbeat): Promise<void> {
    if (!this.heartbeatPersistence) return;

    await this.heartbeatPersistence.save({
      sessionId: this.sessionId,
      heartbeat,
      context: {
        cwd: this.cwd,
        lastMessage: this.lastUserMessage || undefined,
        lastTool: this.lastToolName || undefined,
        pendingToolCalls: this.pendingToolCalls.size > 0 ? Array.from(this.pendingToolCalls.values()) : undefined,
      },
      timestamp: new Date().toISOString(),
    });
  }

  private async checkRecovery(): Promise<void> {
    if (!this.heartbeatRecovery) return;
    const recovery = await this.heartbeatRecovery.checkForRecovery();
    if (!recovery.available || !recovery.state) return;

    const message = `\n[Recovery available from ${recovery.state.timestamp} - last state ${recovery.state.heartbeat.state}]\n`;
    this.emit({ type: 'text', content: message });
  }

  private setHeartbeatState(state: AgentState): void {
    this.heartbeatManager?.setState(state);
  }

  private recordHeartbeatActivity(type: 'message' | 'tool' | 'error'): void {
    this.heartbeatManager?.recordActivity(type);
  }

  private async startEnergySystem(): Promise<void> {
    if (!this.config || this.config.energy?.enabled === false) return;
    const statePath = join(getConfigDir(), 'energy', 'state.json');
    this.energyManager = new EnergyManager(this.config.energy, new EnergyStorage(statePath));
    await this.energyManager.initialize();
    this.refreshEnergyEffects();
  }

  private consumeEnergy(action: 'message' | 'toolCall' | 'llmCall' | 'longContext'): void {
    if (!this.energyManager) return;
    this.energyManager.consume(action);
    this.refreshEnergyEffects();
  }

  private refreshEnergyEffects(): void {
    if (!this.energyManager) return;
    const effects = this.energyManager.getEffects();
    this.energyEffects = effects;
    if (this.lastEnergyLevel !== effects.level) {
      this.lastEnergyLevel = effects.level;
      if (effects.message) {
        this.emit({ type: 'text', content: `\n${effects.message}\n` });
      }
    }
  }

  private async applyEnergyDelay(): Promise<void> {
    const delay = this.energyEffects?.processingDelayMs ?? 0;
    if (delay <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private applyEnergyPersonality(systemPrompt: string | undefined): string | undefined {
    if (!systemPrompt) return systemPrompt;
    if (!this.energyEffects) return systemPrompt;
    return applyPersonality(systemPrompt, this.energyEffects);
  }

  /**
   * Inject pending messages into context at turn start
   */
  private async injectPendingMessages(): Promise<void> {
    if (!this.messagesManager) return;

    try {
      if (this.pendingMessagesContext) {
        const previous = this.pendingMessagesContext.trim();
        this.context.removeSystemMessages((content) => content.trim() === previous);
        this.pendingMessagesContext = null;
      }

      const pending = await this.messagesManager.getUnreadForInjection();
      if (pending.length === 0) {
        return;
      }

      // Build and store context string
      this.pendingMessagesContext = this.messagesManager.buildInjectionContext(pending);

      // Add as system message so it appears in context
      if (this.pendingMessagesContext) {
        this.context.addSystemMessage(this.pendingMessagesContext);
      }

      // Mark messages as injected
      await this.messagesManager.markInjected(pending.map((m) => m.id));
    } catch (error) {
      // Log but don't fail - messages are non-critical
      console.error('Failed to inject pending messages:', error);
      this.pendingMessagesContext = null;
    }
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
        if (schedule.sessionId && schedule.sessionId !== this.sessionId) {
          continue;
        }
        const locked = await acquireScheduleLock(this.cwd, schedule.id, this.sessionId);
        if (!locked) continue;
        const alreadyQueued = this.scheduledQueue.some((item) => item.id === schedule.id);
        if (alreadyQueued) {
          await releaseScheduleLock(this.cwd, schedule.id, this.sessionId);
          continue;
        }
        let scheduleToQueue = schedule;
        if (!schedule.sessionId) {
          const claimed = await updateSchedule(this.cwd, schedule.id, (current) => {
            if (current.sessionId) return current;
            return {
              ...current,
              sessionId: this.sessionId,
              updatedAt: Date.now(),
            };
          });
          if (!claimed || (claimed.sessionId && claimed.sessionId !== this.sessionId)) {
            await releaseScheduleLock(this.cwd, schedule.id, this.sessionId);
            continue;
          }
          scheduleToQueue = claimed;
        }
        this.scheduledQueue.push(scheduleToQueue);
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
        if (
          !current ||
          current.status !== 'active' ||
          !current.nextRunAt ||
          current.nextRunAt > Date.now() ||
          (current.sessionId && current.sessionId !== this.sessionId)
        ) {
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
    const maxMessages = this.contextConfig?.maxMessages ?? 100;
    this.context = new AgentContext(maxMessages);
    if (this.systemPrompt) {
      this.context.addSystemMessage(this.systemPrompt);
    }
    if (this.extraSystemPrompt) {
      this.context.addSystemMessage(this.extraSystemPrompt);
    }
    if (this.projectContext) {
      this.setProjectContext(this.projectContext);
    }
    this.contextManager?.refreshState(this.context.getMessages());
  }

  /**
   * Build system prompt from base + extra + assistant prompt + identity + system messages
   */
  private buildSystemPrompt(messages: Message[]): string | undefined {
    const parts: string[] = [];

    if (this.systemPrompt) {
      parts.push(this.systemPrompt);
    }
    if (this.extraSystemPrompt) {
      parts.push(this.extraSystemPrompt);
    }

    const skillDescriptions = this.skillLoader.getSkillDescriptions();
    if (skillDescriptions) {
      parts.push(`## Skills\n${skillDescriptions}`);
    }

    // Add assistant-specific system prompt addition
    const assistant = this.assistantManager?.getActive();
    if (assistant?.settings?.systemPromptAddition) {
      parts.push(`## Assistant Instructions\n${assistant.settings.systemPromptAddition}`);
    }

    if (this.identityContext) {
      parts.push(`## Your Identity\n${this.identityContext}`);
    }

    for (const msg of messages) {
      if (msg.role !== 'system') continue;
      const content = (msg.content ?? '').trim();
      if (!content) continue;
      if (parts.includes(content)) continue;
      parts.push(content);
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined;
  }

  private async initializeIdentitySystem(): Promise<void> {
    const basePath = getConfigDir();
    this.assistantManager = new AssistantManager(basePath);
    await this.assistantManager.initialize();

    if (this.assistantManager.listAssistants().length === 0) {
      const created = await this.assistantManager.createAssistant({
        name: 'Default Assistant',
        settings: { model: this.config?.llm?.model || 'claude-opus-4-5' },
      });
      this.assistantId = created.id;
    }

    if (this.assistantId) {
      try {
        await this.assistantManager.switchAssistant(this.assistantId);
      } catch {
        this.assistantId = null;
      }
    }

    const active = this.assistantManager.getActive();
    if (active) {
      this.identityManager = this.assistantManager.getIdentityManager(active.id);
      await this.identityManager.initialize();
      if (this.identityManager.listIdentities().length === 0) {
        await this.identityManager.createIdentity({ name: 'Default' });
      }
      this.identityContext = await this.identityManager.buildSystemPromptContext();
    }
  }

  private buildContextConfig(config: AssistantsConfig): ContextConfig {
    const limits = getLimits();
    const configuredMax = config.context?.maxContextTokens ?? limits.maxTotalContextTokens;
    const maxContextTokens = Math.max(1000, Math.min(configuredMax, limits.maxTotalContextTokens));
    const summaryTriggerRatioRaw = config.context?.summaryTriggerRatio ?? 0.8;
    const summaryTriggerRatio = Math.min(0.95, Math.max(0.5, summaryTriggerRatioRaw));
    const targetContextTokensRaw =
      config.context?.targetContextTokens ?? Math.floor(maxContextTokens * 0.85);
    const targetContextTokens = Math.min(maxContextTokens, Math.max(1000, targetContextTokensRaw));
    const keepRecentMessages = Math.max(0, config.context?.keepRecentMessages ?? 10);
    const maxMessages = Math.max(keepRecentMessages + 10, config.context?.maxMessages ?? 500);

    return {
      enabled: config.context?.enabled ?? true,
      maxContextTokens,
      targetContextTokens,
      summaryTriggerRatio,
      keepRecentMessages,
      keepSystemPrompt: config.context?.keepSystemPrompt ?? true,
      summaryStrategy: config.context?.summaryStrategy ?? 'hybrid',
      summaryModel: config.context?.summaryModel,
      summaryMaxTokens: config.context?.summaryMaxTokens ?? 2000,
      maxMessages,
    };
  }

  private buildHeartbeatConfig(config: AssistantsConfig): HeartbeatRuntimeConfig | null {
    if (config.heartbeat?.enabled === false) return null;
    const intervalMs = Math.max(1000, config.heartbeat?.intervalMs ?? 15000);
    const staleThresholdMs = Math.max(intervalMs * 2, config.heartbeat?.staleThresholdMs ?? 120000);
    const persistPath =
      config.heartbeat?.persistPath ??
      join(getConfigDir(), 'heartbeats', `${this.sessionId}.json`);

    return {
      intervalMs,
      staleThresholdMs,
      persistPath,
    };
  }

  private async buildSummaryClient(contextConfig: ContextConfig): Promise<LLMClient> {
    if (!this.config || !this.llmClient) {
      throw new Error('LLM client not initialized');
    }
    const summaryModel = contextConfig.summaryModel;
    if (!summaryModel || summaryModel === this.config.llm.model) {
      return this.llmClient;
    }
    try {
      return await createLLMClient({ ...this.config.llm, model: summaryModel });
    } catch {
      return this.llmClient;
    }
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
    return tools.filter((tool) => {
      const name = tool.name.toLowerCase();
      if (name === 'ask_user') return true;
      return allowed.has(name);
    });
  }

  private isToolAllowed(name: string): boolean {
    const allowed = this.getEffectiveAllowedTools();
    if (!allowed) return true;
    if (name.toLowerCase() === 'ask_user') return true;
    return allowed.has(name.toLowerCase());
  }
}

function parseErrorCode(message: string): { code: ErrorCode; message: string } | null {
  const index = message.indexOf(':');
  if (index === -1) return null;
  const codeCandidate = message.slice(0, index).trim() as ErrorCode;
  const rest = message.slice(index + 1).trim();
  const codes = Object.values(ErrorCodes) as ErrorCode[];
  if (!codes.includes(codeCandidate)) return null;
  return { code: codeCandidate, message: rest || message };
}

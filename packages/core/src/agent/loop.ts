import type { Message, Tool, StreamChunk, ToolCall, ToolResult, AssistantsConfig, ScheduledCommand, VoiceState, ActiveIdentityInfo, HeartbeatState } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import { join } from 'path';
import { AssistantContext } from './context';
import {
  ContextManager,
  ContextInjector,
  HybridSummarizer,
  LLMSummarizer,
  TokenCounter,
  type ContextConfig,
  type ContextInfo,
  type ContextInjectionConfig,
} from '../context';
import { ToolRegistry } from '../tools/registry';
import { ConnectorBridge, registerConnectorExecuteTool, registerConnectorsListTool, registerConnectorsSearchTool } from '../tools/connector';
import { registerConnectorAutoRefreshTool } from '../tools/connector-refresh';
import { registerConfigTools } from '../tools/config';
import { registerAssistantTools } from '../tools/assistant';
import { registerIdentityTools } from '../tools/identity';
import { registerModelTools } from '../tools/model';
import { registerEnergyTools } from '../tools/energy';
import { registerContextEntryTools } from '../tools/context-entries';
import { registerSecurityTools } from '../tools/security';
import { getSecurityLogger } from '../security/logger';
import { registerLogsTools } from '../tools/logs';
import { registerVerificationTools } from '../tools/verification';
import { BashTool } from '../tools/bash';
import { FilesystemTools } from '../tools/filesystem';
import { WebTools } from '../tools/web';
import { FeedbackTool } from '../tools/feedback';
import { registerSchedulerTools, type SchedulerContext } from '../tools/scheduler';
import { ImageTools } from '../tools/image';
import { SkillTool, createSkillListTool, createSkillReadTool, createSkillExecuteTool } from '../tools/skills';
import { createAskUserTool, type AskUserHandler } from '../tools/ask-user';
import { WaitTool, SleepTool } from '../tools/wait';
import { runHookAssistant } from './subagent';
import { SkillLoader } from '../skills/loader';
import { SkillExecutor } from '../skills/executor';
import {
  HookLoader,
  HookExecutor,
  HookStore,
  nativeHookRegistry,
  ScopeContextManager,
  createScopeVerificationHook,
  registerHooksTools,
} from '../hooks';
import { CommandLoader, CommandExecutor, BuiltinCommands, type TokenUsage, type CommandContext, type CommandResult } from '../commands';
import { createLLMClient, type LLMClient } from '../llm/client';
import { loadConfig, loadHooksConfig, loadSystemPrompt, ensureConfigDir, getConfigDir } from '../config';
import {
  HeartbeatManager,
  StatePersistence,
  RecoveryManager,
  createAutoScheduleHeartbeatHook,
  ensureWatchdogSchedule,
  installHeartbeatSkills,
  type AssistantState,
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
import { ConnectorAutoRefreshManager } from '../connectors/auto-refresh';
import { VoiceManager } from '../voice/manager';
import { AssistantManager, IdentityManager } from '../identity';
import { createInboxManager, registerInboxTools, type InboxManager } from '../inbox';
import { createWalletManager, registerWalletTools, type WalletManager } from '../wallet';
import { createSecretsManager, registerSecretsTools, type SecretsManager } from '../secrets';
import { JobManager, createJobTools } from '../jobs';
import { createMessagesManager, registerMessagesTools, type MessagesManager } from '../messages';
import { registerSessionTools, type SessionContext, type SessionQueryFunctions } from '../sessions';
import { registerProjectTools, type ProjectToolContext } from '../tools/projects';
import { registerSelfAwarenessTools } from '../tools/self-awareness';
import { registerMemoryTools } from '../tools/memory';
import { registerAssistantTools as registerAssistantSpawnTools } from '../tools/agents';
import { registerAssistantRegistryTools } from '../tools/agent-registry';
import { registerCapabilityTools } from '../tools/capabilities';
import { registerVoiceTools } from '../tools/voice';
import { registerTaskTools } from '../tools/tasks';
import { registerSwarmTools, type SwarmToolContext } from '../tools/swarm';
import { SwarmCoordinator, type SwarmCoordinatorContext } from '../swarm/coordinator';
import { GlobalMemoryManager, MemoryInjector, type MemoryConfig } from '../memory';
import { SubassistantManager, type SubassistantManagerContext, type SubassistantResult, type SubassistantLoopConfig } from './subagent-manager';
import { BudgetTracker, registerBudgetTools, type BudgetScope } from '../budget';
import { PolicyEvaluator, GuardrailsStore, registerGuardrailsTools, type GuardrailsConfig, type PolicyEvaluationResult } from '../guardrails';
import { getGlobalRegistry, type AssistantRegistryService, type RegisteredAssistant, type AssistantType } from '../registry';
import { CapabilityEnforcer, type CapabilityEnforcementResult } from '../capabilities';
import type { BudgetConfig, CapabilitiesConfigShared } from '@hasna/assistants-shared';

export interface AssistantLoopOptions {
  config?: AssistantsConfig;
  cwd?: string;
  sessionId?: string;
  assistantId?: string;
  allowedTools?: string[];
  extraSystemPrompt?: string;
  llmClient?: LLMClient;
  /** Override the model from config (e.g., assistant-specific model selection) */
  model?: string;
  onChunk?: (chunk: StreamChunk) => void;
  onToolStart?: (toolCall: ToolCall) => void;
  onToolEnd?: (toolCall: ToolCall, result: ToolResult) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
  /** Session context for session management tools (userId, query functions) */
  sessionContext?: {
    userId: string;
    queryFn: SessionQueryFunctions;
  };
  /** Subassistant depth level (0 = root assistant, used internally) */
  depth?: number;
  /** Budget configuration for resource limits */
  budgetConfig?: BudgetConfig;
  /** Callback when budget warning/exceeded occurs */
  onBudgetWarning?: (warning: string) => void;
  /** Guardrails configuration for security policies */
  guardrailsConfig?: GuardrailsConfig;
  /** Callback when guardrails violation occurs */
  onGuardrailsViolation?: (result: PolicyEvaluationResult, toolName: string) => void;
}

/**
 * Main assistant loop - orchestrates the conversation
 */
export class AssistantLoop {
  private context: AssistantContext;
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
  private sessionStartTime: number = Date.now();
  private isRunning = false;
  private shouldStop = false;
  private toolAbortController: AbortController | null = null;
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
  private memoryManager: GlobalMemoryManager | null = null;
  private memoryInjector: MemoryInjector | null = null;
  private contextInjector: ContextInjector | null = null;
  private pendingContextInjection: string | null = null;
  private subassistantManager: SubassistantManager | null = null;
  private depth: number = 0;
  private pendingMessagesContext: string | null = null;
  private pendingMemoryContext: string | null = null;
  private identityContext: string | null = null;
  private projectContext: string | null = null;
  private activeProjectId: string | null = null;
  private assistantId: string | null = null;
  private askUserHandler: AskUserHandler | null = null;
  private sessionContextOptions: { userId: string; queryFn: SessionQueryFunctions } | null = null;
  private modelOverride: string | null = null;
  private budgetTracker: BudgetTracker | null = null;
  private budgetConfig: BudgetConfig | null = null;
  private policyEvaluator: PolicyEvaluator | null = null;
  private guardrailsConfig: GuardrailsConfig | null = null;
  private onGuardrailsViolation?: (result: PolicyEvaluationResult, toolName: string) => void;
  private capabilityEnforcer: CapabilityEnforcer | null = null;
  private capabilitiesConfig: CapabilitiesConfigShared | null = null;
  private onCapabilityViolation?: (result: CapabilityEnforcementResult, context: string) => void;
  private registryService: AssistantRegistryService | null = null;
  private registeredAssistantId: string | null = null;
  private swarmCoordinator: SwarmCoordinator | null = null;
  private paused = false;
  private pauseResolve: (() => void) | null = null;

  // Event callbacks
  private onChunk?: (chunk: StreamChunk) => void;
  private onToolStart?: (toolCall: ToolCall) => void;
  private onToolEnd?: (toolCall: ToolCall, result: ToolResult) => void;
  private onTokenUsage?: (usage: TokenUsage) => void;
  private onBudgetWarning?: (warning: string) => void;

  constructor(options: AssistantLoopOptions = {}) {
    this.cwd = options.cwd || process.cwd();
    this.sessionId = options.sessionId || generateId();
    this.assistantId = options.assistantId || null;
    this.depth = options.depth ?? 0;
    this.context = new AssistantContext();
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
    this.modelOverride = options.model || null;
    this.sessionContextOptions = options.sessionContext || null;

    this.onChunk = options.onChunk;
    this.onToolStart = options.onToolStart;
    this.onToolEnd = options.onToolEnd;
    this.onTokenUsage = options.onTokenUsage;
    this.onBudgetWarning = options.onBudgetWarning;
    this.budgetConfig = options.budgetConfig || null;
    this.guardrailsConfig = options.guardrailsConfig || null;
    this.onGuardrailsViolation = options.onGuardrailsViolation;

    // Initialize budget tracker if config provided
    if (this.budgetConfig) {
      this.budgetTracker = new BudgetTracker(this.sessionId, this.budgetConfig);
    }

    // Initialize policy evaluator if config provided
    if (this.guardrailsConfig) {
      this.policyEvaluator = new PolicyEvaluator(this.guardrailsConfig);
    }
  }

  /**
   * Initialize the assistant (parallelized for fast startup)
   */
  async initialize(): Promise<void> {
    // Phase 1: Load config and ensure directories exist (fast, needed for phase 2)
    const [config] = await Promise.all([
      loadConfig(this.cwd),
      ensureConfigDir(this.sessionId),
    ]);
    this.config = config;
    // Apply model override if provided (e.g., assistant-specific model selection)
    if (this.modelOverride) {
      this.config = {
        ...this.config,
        llm: {
          ...this.config.llm,
          model: this.modelOverride,
        },
      };
    }
    configureLimits(this.config.validation);
    this.toolRegistry.setValidationConfig(this.config.validation);
    this.contextConfig = this.buildContextConfig(this.config);
    this.context.setMaxMessages(this.contextConfig.maxMessages);
    this.builtinCommands.updateTokenUsage({ maxContextTokens: this.contextConfig.maxContextTokens });
    if (this.config.voice) {
      this.voiceManager = new VoiceManager(this.config.voice);
    }
    // Initialize budget tracker from config if not already set via options
    if (!this.budgetTracker && this.config.budget) {
      this.budgetConfig = this.config.budget;
      this.budgetTracker = new BudgetTracker(this.sessionId, this.budgetConfig);
    } else if (this.budgetTracker && this.config.budget) {
      // Merge config budget with options budget (options take precedence)
      this.budgetConfig = { ...this.config.budget, ...this.budgetConfig };
      this.budgetTracker.updateConfig(this.budgetConfig);
    }
    // Initialize guardrails evaluator from config if not already set via options
    if (!this.policyEvaluator && this.config.guardrails) {
      this.guardrailsConfig = this.config.guardrails as GuardrailsConfig;
      this.policyEvaluator = new PolicyEvaluator(this.guardrailsConfig);
    } else if (this.policyEvaluator && this.config.guardrails) {
      // Merge config guardrails with options guardrails (options take precedence)
      this.guardrailsConfig = { ...this.config.guardrails, ...this.guardrailsConfig } as GuardrailsConfig;
      this.policyEvaluator.updateConfig(this.guardrailsConfig);
    }
    // Initialize capability enforcer from config
    if (!this.capabilityEnforcer && this.config.capabilities) {
      this.capabilitiesConfig = this.config.capabilities as CapabilitiesConfigShared;
      this.capabilityEnforcer = new CapabilityEnforcer(this.capabilitiesConfig);
    } else if (this.capabilityEnforcer && this.config.capabilities) {
      this.capabilitiesConfig = { ...this.config.capabilities, ...this.capabilitiesConfig } as CapabilitiesConfigShared;
      this.capabilityEnforcer.updateConfig(this.capabilitiesConfig);
    }
    // Initialize context injector if enabled
    const injectionConfig = this.config.context?.injection;
    if (injectionConfig?.enabled !== false) {
      this.contextInjector = new ContextInjector(this.cwd, injectionConfig as Partial<ContextInjectionConfig>);
    }
    await this.initializeIdentitySystem();
    await ConnectorAutoRefreshManager.getInstance().start();

    // Normalize connectors config to extract enabled list
    const connectorsConfig = this.config.connectors;
    let connectorNames: string[] | undefined;
    if (connectorsConfig) {
      if (Array.isArray(connectorsConfig)) {
        // String array format (backwards compatible)
        connectorNames = connectorsConfig.length > 0 && !connectorsConfig.includes('*')
          ? connectorsConfig
          : undefined;
      } else if (connectorsConfig.enabled && connectorsConfig.enabled.length > 0) {
        // Object format with enabled list
        connectorNames = !connectorsConfig.enabled.includes('*')
          ? connectorsConfig.enabled
          : undefined;
      }
    }

    // Fast discovery (PATH scan only) so connector tools are available immediately.
    this.connectorBridge.fastDiscover(connectorNames);
    this.connectorBridge.registerAll(this.toolRegistry, connectorsConfig);

    // Start connector discovery in the background so chat can start immediately.
    this.connectorDiscovery = this.connectorBridge.discover(connectorNames)
      .then(() => {
        this.connectorBridge.registerAll(this.toolRegistry, connectorsConfig);
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
    const skillExecuteTool = createSkillExecuteTool(() => this.skillLoader);
    this.toolRegistry.register(skillExecuteTool.tool, skillExecuteTool.executor);
    const askUserTool = createAskUserTool(() => this.askUserHandler);
    this.toolRegistry.register(askUserTool.tool, askUserTool.executor);
    this.toolRegistry.register(FeedbackTool.tool, FeedbackTool.executor);

    // Register scheduler tools with session context
    registerSchedulerTools(this.toolRegistry, () => ({
      sessionId: this.sessionId,
      cwd: this.cwd,
    }));

    this.toolRegistry.register(WaitTool.tool, WaitTool.executor);
    this.toolRegistry.register(SleepTool.tool, SleepTool.executor);

    // Initialize inbox if enabled
    if (this.config?.inbox?.enabled) {
      const assistant = this.assistantManager?.getActive();
      const assistantId = assistant?.id || this.sessionId;
      const assistantName = assistant?.name || 'assistant';
      this.inboxManager = createInboxManager(
        assistantId,
        assistantName,
        this.config.inbox,
        getConfigDir()
      );
      registerInboxTools(this.toolRegistry, () => this.inboxManager);
    }

    // Initialize wallet if enabled
    if (this.config?.wallet?.enabled) {
      const assistant = this.assistantManager?.getActive();
      const assistantId = assistant?.id || this.sessionId;
      this.walletManager = createWalletManager(assistantId, this.config.wallet);
      registerWalletTools(this.toolRegistry, () => this.walletManager);
    }

    // Initialize secrets if enabled
    if (this.config?.secrets?.enabled) {
      const assistant = this.assistantManager?.getActive();
      const assistantId = assistant?.id || this.sessionId;
      this.secretsManager = createSecretsManager(assistantId, this.config.secrets);
      registerSecretsTools(this.toolRegistry, () => this.secretsManager);
    }

    // Initialize messages if enabled
    if (this.config?.messages?.enabled) {
      const assistant = this.assistantManager?.getActive();
      const assistantId = assistant?.id || this.sessionId;
      const assistantName = assistant?.name || 'assistant';
      this.messagesManager = createMessagesManager(assistantId, assistantName, this.config.messages);
      await this.messagesManager.initialize();
      registerMessagesTools(this.toolRegistry, () => this.messagesManager);

      // Start watching for real-time message notifications
      this.messagesManager.startWatching();
      this.messagesManager.onMessage((message) => {
        // When a new message arrives, prepare it for injection at the next turn
        if (message.priority === 'urgent' || message.priority === 'high') {
          const context = this.messagesManager!.buildInjectionContext([message]);
          if (context) {
            this.pendingMessagesContext = context;
          }
        }
      });
    }

    // Initialize memory system if enabled
    const memoryConfig = this.config?.memory;
    if (memoryConfig?.enabled !== false) {
      const assistant = this.assistantManager?.getActive();
      const assistantScopeId = assistant?.id || this.sessionId;
      this.memoryManager = new GlobalMemoryManager({
        defaultScope: 'private',
        scopeId: assistantScopeId,
        sessionId: this.sessionId,
        config: {
          enabled: memoryConfig?.enabled ?? true,
          injection: {
            enabled: memoryConfig?.injection?.enabled ?? true,
            maxTokens: memoryConfig?.injection?.maxTokens ?? 500,
            minImportance: memoryConfig?.injection?.minImportance ?? 5,
            categories: memoryConfig?.injection?.categories ?? ['preference', 'fact'],
            refreshInterval: memoryConfig?.injection?.refreshInterval ?? 5,
          },
          storage: {
            maxEntries: memoryConfig?.storage?.maxEntries ?? 1000,
            defaultTTL: memoryConfig?.storage?.defaultTTL,
          },
          scopes: {
            globalEnabled: memoryConfig?.scopes?.globalEnabled ?? true,
            sharedEnabled: memoryConfig?.scopes?.sharedEnabled ?? true,
            privateEnabled: memoryConfig?.scopes?.privateEnabled ?? true,
          },
        },
      });
      this.memoryInjector = new MemoryInjector(this.memoryManager, {
        enabled: memoryConfig?.injection?.enabled ?? true,
        maxTokens: memoryConfig?.injection?.maxTokens ?? 500,
        minImportance: memoryConfig?.injection?.minImportance ?? 5,
        categories: memoryConfig?.injection?.categories ?? ['preference', 'fact'],
        refreshInterval: memoryConfig?.injection?.refreshInterval ?? 5,
      });
      registerMemoryTools(this.toolRegistry, () => this.memoryManager);
    }

    // Register session tools if session context is provided
    if (this.sessionContextOptions) {
      registerSessionTools(this.toolRegistry, () => {
        if (!this.sessionContextOptions) return null;
        return {
          userId: this.sessionContextOptions.userId,
          sessionId: this.sessionId,
          queryFn: this.sessionContextOptions.queryFn,
        };
      });
    }

    // Register project tools (always available for managing projects and plans)
    registerProjectTools(this.toolRegistry, () => ({
      cwd: this.cwd,
    }));

    // Register task tools (always available for task queue management)
    registerTaskTools(this.toolRegistry, {
      cwd: this.cwd,
      projectId: this.activeProjectId ?? undefined,
    });

    // Register self-awareness tools (always available for assistant introspection)
    registerSelfAwarenessTools(this.toolRegistry, {
      getContextManager: () => this.contextManager,
      getContextInfo: () => this.getContextInfo(),
      getAssistantManager: () => this.assistantManager,
      getIdentityManager: () => this.identityManager,
      getEnergyManager: () => this.energyManager,
      getEnergyState: () => this.getEnergyState(),
      getWalletManager: () => this.walletManager,
      sessionId: this.sessionId,
      model: this.config?.llm?.model,
    });

    // Register connectors list tool
    registerConnectorsListTool(this.toolRegistry, {
      getConnectorBridge: () => this.connectorBridge,
    });
    registerConnectorsSearchTool(this.toolRegistry, {
      getConnectorBridge: () => this.connectorBridge,
      onConnectorSelected: (connectorName) => {
        this.connectorBridge.registerConnector(this.toolRegistry, connectorName);
      },
    });
    registerConnectorExecuteTool(this.toolRegistry, {
      getConnectorBridge: () => this.connectorBridge,
    });
    registerConnectorAutoRefreshTool(this.toolRegistry);

    // Register config tools
    registerConfigTools(this.toolRegistry, {
      cwd: this.cwd,
    });

    // Register assistant management tools
    registerAssistantTools(this.toolRegistry, {
      getAssistantManager: () => this.assistantManager,
    });

    // Register identity management tools
    registerIdentityTools(this.toolRegistry, {
      getIdentityManager: () => this.identityManager,
    });

    // Register model management tools
    registerModelTools(this.toolRegistry, {
      getModel: () => this.getModel(),
      switchModel: async (modelId: string) => this.switchModel(modelId),
    });

    // Register energy tools
    registerEnergyTools(this.toolRegistry, {
      getEnergyManager: () => this.energyManager,
      getEnergyState: () => this.getEnergyState(),
      restEnergy: (amount?: number) => {
        if (this.energyManager) {
          this.energyManager.rest(amount);
          this.refreshEnergyEffects();
        }
      },
    });

    // Register context entry tools
    registerContextEntryTools(this.toolRegistry, {
      cwd: this.cwd,
      getActiveProjectId: () => this.activeProjectId,
      setProjectContext: (content: string | null) => {
        this.setProjectContext(content);
      },
      getConnectors: () => this.connectorBridge.getConnectors().map((c: { name: string; description?: string; cli?: string; tools?: Array<{ name: string; description: string }> }) => ({
        name: c.name,
        description: c.description,
        cli: c.cli,
        commands: c.tools?.map((t: { name: string; description: string }) => ({
          name: t.name,
          description: t.description,
        })),
      })),
    });

    // Register security tools
    registerSecurityTools(this.toolRegistry, {
      getSecurityLogger,
      sessionId: this.sessionId,
    });

    // Register logs tools (read-only access to all log sources)
    registerLogsTools(this.toolRegistry, {
      sessionId: this.sessionId,
    });

    // Register verification tools
    registerVerificationTools(this.toolRegistry, {
      sessionId: this.sessionId,
    });

    // Initialize subassistant manager and register assistant tools
    this.initializeSubassistantManager();
    registerAssistantSpawnTools(this.toolRegistry, {
      getSubassistantManager: () => this.subassistantManager,
      getAssistantManager: () => this.assistantManager,
      getDepth: () => this.depth,
      getCwd: () => this.cwd,
      getSessionId: () => this.sessionId,
    });

    // Register assistant registry tools (for querying running assistants)
    registerAssistantRegistryTools(this.toolRegistry, {
      getRegistryService: () => this.registryService,
    });

    // Register swarm tools for multi-assistant orchestration
    registerSwarmTools(this.toolRegistry, {
      getSwarmCoordinator: () => this.getOrCreateSwarmCoordinator(),
      isSwarmEnabled: () => this.subassistantManager !== null,
    });

    // Register capability tools (for querying assistant capabilities)
    registerCapabilityTools(this.toolRegistry, {
      getCapabilities: () => this.capabilityEnforcer?.getResolvedCapabilities() ?? null,
      isEnabled: () => this.capabilityEnforcer?.isEnabled() ?? false,
      getOrchestrationLevel: () => this.capabilityEnforcer?.getResolvedCapabilities()?.orchestration.level ?? null,
      getToolPolicy: () => this.capabilityEnforcer?.getResolvedCapabilities()?.tools.policy ?? null,
      getAllowedTools: () => this.allowedTools ? Array.from(this.allowedTools) : null,
      getDeniedTools: () => this.capabilitiesConfig?.deniedTools ?? null,
    });

    // Register voice tools (available when voice manager is configured)
    registerVoiceTools(this.toolRegistry, {
      getVoiceManager: () => this.voiceManager,
    });

    // Register budget tools (always available for budget introspection)
    registerBudgetTools(this.toolRegistry, () => this.budgetTracker);

    // Register guardrails tools (read-only, always available)
    registerGuardrailsTools(this.toolRegistry, () => new GuardrailsStore(this.cwd));

    // Register hooks tools (always available for hook inspection)
    registerHooksTools(this.toolRegistry, () => new HookStore(this.cwd));

    // Initialize jobs system if enabled
    if (this.config?.jobs?.enabled !== false) {
      this.jobManager = new JobManager(this.config?.jobs || {}, this.sessionId);

      // Set up job completion notifications
      this.jobManager.onJobComplete((event) => {
        // Notify via stream chunk with hook support
        const statusEmoji = event.status === 'completed' ? '✓' : event.status === 'failed' ? '✗' : '⚠';
        void this.emitNotification({
          type: 'job_complete',
          title: `Job ${event.status} ${statusEmoji}`,
          message: `${event.connector} (${event.jobId}): ${event.summary}`,
          priority: event.status === 'failed' ? 'high' : 'normal',
        });
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

    // Register autonomous heartbeat Stop hook and setup watchdog
    const heartbeatCfg = this.config.heartbeat;
    if (heartbeatCfg?.autonomous) {
      nativeHookRegistry.register(createAutoScheduleHeartbeatHook());
      // Install main-loop and watchdog skills (no-op if already present)
      installHeartbeatSkills().catch(() => {});
      // Pass heartbeat config to native hook context
      nativeHookRegistry.setConfig({
        ...nativeHookRegistry.getConfig(),
        heartbeat: {
          autonomous: heartbeatCfg.autonomous,
          maxSleepMs: heartbeatCfg.maxSleepMs,
          watchdogEnabled: heartbeatCfg.watchdogEnabled,
          watchdogIntervalMs: heartbeatCfg.watchdogIntervalMs,
        },
      });
      // Setup watchdog if enabled
      if (heartbeatCfg.watchdogEnabled) {
        ensureWatchdogSchedule(
          this.cwd,
          this.sessionId,
          heartbeatCfg.watchdogIntervalMs,
        ).catch(() => {});
      }
    }

    this.hookExecutor.setAssistantRunner((hook, input, timeout) =>
      runHookAssistant({ hook, input, timeout, cwd: this.cwd })
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
    this.startAssistantHeartbeat();
    await this.startEnergySystem();
  }

  /**
   * Process a user message
   */
  async process(userMessage: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Assistant is already processing a message');
    }

    // Set isRunning early to prevent race conditions with scheduled commands.
    // The heartbeat timer checks isRunning before draining the scheduled queue,
    // so we need to set it before any async operations to avoid concurrent runs.
    this.isRunning = true;

    try {
      // Inject pending messages before processing
      await this.injectPendingMessages();
      // Inject relevant memories based on user message
      await this.injectMemoryContext(userMessage);
      // Inject environment context (datetime, cwd, etc.)
      await this.injectContextInfo();
    } catch (error) {
      // If injection fails, reset isRunning before re-throwing
      this.isRunning = false;
      throw error;
    }

    // runMessage handles its own isRunning state in its finally block
    await this.runMessage(userMessage, 'user');
  }

  private async runMessage(
    userMessage: string,
    source: 'user' | 'schedule'
  ): Promise<{ ok: boolean; summary?: string; error?: string }> {
    if (!this.llmClient || !this.config) {
      throw new Error('Assistant not initialized. Call initialize() first.');
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
        // Clear pending context - explicit tool commands bypass the LLM
        this.pendingMemoryContext = null;
        this.pendingContextInjection = null;
        return explicitToolResult;
      }

      if (userMessage.startsWith('/')) {
        const parsed = this.commandExecutor.parseCommand(userMessage);
        const command = parsed ? this.commandLoader.getCommand(parsed.name) : undefined;
        const skill = parsed ? this.skillLoader.getSkill(parsed.name) : undefined;

        if (command) {
          const commandResult = await this.handleCommand(userMessage);
          if (commandResult.handled) {
            // Clear pending context - commands bypass the LLM
            this.pendingMemoryContext = null;
            this.pendingContextInjection = null;
            if (commandResult.clearConversation) {
              this.resetContext();
            }
            if (commandResult.exit) {
              this.emit({ type: 'exit' });
            }
            if (commandResult.showPanel) {
              this.emit({
                type: 'show_panel',
                panel: commandResult.showPanel,
                panelValue: commandResult.panelInitialValue,
              });
            }
            // Session actions: encode in show_panel with session-action prefix
            if (commandResult.sessionAction) {
              const payload = JSON.stringify({
                action: commandResult.sessionAction,
                number: commandResult.sessionNumber,
                label: commandResult.sessionLabel,
                agent: commandResult.sessionAgent,
              });
              this.emit({
                type: 'show_panel',
                panel: 'assistants',
                panelValue: `session:${payload}`,
              });
            }
            return { ok: true, summary: `Handled ${userMessage}` };
          }
          if (commandResult.prompt) {
            userMessage = commandResult.prompt;
          }
        } else if (skill) {
          const handled = await this.handleSkillInvocation(userMessage);
          if (handled) {
            // Clear pending context - skills handle their own context
            this.pendingMemoryContext = null;
            this.pendingContextInjection = null;
            return { ok: true, summary: `Executed ${userMessage}` };
          }
        } else {
          const commandResult = await this.handleCommand(userMessage);
          if (commandResult.handled) {
            // Clear pending context - commands bypass the LLM
            this.pendingMemoryContext = null;
            this.pendingContextInjection = null;
            if (commandResult.showPanel) {
              this.emit({
                type: 'show_panel',
                panel: commandResult.showPanel,
                panelValue: commandResult.panelInitialValue,
              });
            }
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
   * Main assistant loop - continues until no more tool calls
   */
  private async runLoop(): Promise<void> {
    const maxTurns = 50;
    let turn = 0;
    let streamError: Error | null = null;

    try {
      while (turn < maxTurns && !this.shouldStop) {
        turn++;

        // Wait if paused (budget pause enforcement)
        if (this.paused) {
          this.onBudgetWarning?.('Budget exceeded - agent paused. Use /budget resume to continue.');
          this.emit({ type: 'text', content: '\n[Agent paused - budget exceeded. Use /budget resume to continue.]\n' });
          await new Promise<void>((resolve) => {
            this.pauseResolve = resolve;
          });
          this.pauseResolve = null;
          if (this.shouldStop) break;
        }

        // Check budget before starting a new turn
        if (this.isBudgetExceeded()) {
          const onExceeded = this.budgetConfig?.onExceeded || 'warn';
          if (onExceeded === 'stop') {
            this.onBudgetWarning?.('Budget exceeded - stopping before turn ' + turn);
            break;
          }
        }

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

      // Run native Stop hooks (e.g., auto-schedule heartbeat) unconditionally
      try {
        await nativeHookRegistry.execute(
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
          }
        );
      } catch {
        // Native Stop hooks must never block the assistant
      }

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
      const messagesBefore = this.context.getMessages();

      // Fire PreCompact hook before attempting compaction
      const preCompactInput = {
        session_id: this.sessionId,
        hook_event_name: 'PreCompact' as const,
        cwd: this.cwd,
        message_count: messagesBefore.length,
        strategy: this.contextConfig?.summaryStrategy ?? 'llm',
      };

      const preCompactResult = await this.hookExecutor.execute(
        this.hookLoader.getHooks('PreCompact'),
        preCompactInput
      );

      // Hook can skip compaction
      if (preCompactResult?.skip === true) {
        return;
      }

      // Hook can modify strategy via updatedInput
      if (preCompactResult?.updatedInput?.strategy) {
        // Note: strategy modification is informational only - the actual strategy
        // is set at initialization. Hooks can use this to log/track strategy changes.
      }

      const result = await this.contextManager.processMessages(messagesBefore);
      if (!result.summarized) return;

      // Check if the assistant was actively working (had recent tool calls)
      const lastAssistantMessage = this.findLastAssistantMessage(messagesBefore);
      const wasActivelyWorking = lastAssistantMessage?.toolCalls && lastAssistantMessage.toolCalls.length > 0;

      this.context.import(result.messages);

      // Inject continuation prompt if assistant was actively working
      if (wasActivelyWorking && lastAssistantMessage?.toolCalls) {
        const lastToolCall = lastAssistantMessage.toolCalls[lastAssistantMessage.toolCalls.length - 1];
        const continuationPrompt = this.buildContinuationPrompt(lastToolCall);
        this.context.addUserMessage(continuationPrompt);

        const notice = `\n[Context summarized: ${result.summarizedCount} messages compacted. Continuing from: ${lastToolCall.name}]\n`;
        this.emit({ type: 'text', content: notice });
      } else {
        const notice = `\n[Context summarized: ${result.summarizedCount} messages, ${result.tokensBefore.toLocaleString()} -> ${result.tokensAfter.toLocaleString()} tokens]\n`;
        this.emit({ type: 'text', content: notice });
      }
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
   * Find the last assistant message in the conversation
   */
  private findLastAssistantMessage(messages: Message[]): Message | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return messages[i];
      }
    }
    return undefined;
  }

  /**
   * Build a continuation prompt to help the assistant resume work after context compaction
   */
  private buildContinuationPrompt(lastToolCall: ToolCall): string {
    const toolName = lastToolCall.name;
    const toolInput = lastToolCall.input;

    // Build a descriptive hint about what the assistant was doing
    let actionDescription = `using the ${toolName} tool`;
    if (toolName === 'bash' && toolInput && typeof toolInput === 'object' && 'command' in toolInput) {
      actionDescription = `running: ${String(toolInput.command).slice(0, 50)}${String(toolInput.command).length > 50 ? '...' : ''}`;
    } else if (toolName === 'read' && toolInput && typeof toolInput === 'object' && 'file_path' in toolInput) {
      actionDescription = `reading: ${String(toolInput.file_path)}`;
    } else if (toolName === 'write' && toolInput && typeof toolInput === 'object' && 'file_path' in toolInput) {
      actionDescription = `writing to: ${String(toolInput.file_path)}`;
    } else if (toolName === 'edit' && toolInput && typeof toolInput === 'object' && 'file_path' in toolInput) {
      actionDescription = `editing: ${String(toolInput.file_path)}`;
    } else if (toolName === 'glob' && toolInput && typeof toolInput === 'object' && 'pattern' in toolInput) {
      actionDescription = `searching for files matching: ${String(toolInput.pattern)}`;
    } else if (toolName === 'grep' && toolInput && typeof toolInput === 'object' && 'pattern' in toolInput) {
      actionDescription = `searching for: ${String(toolInput.pattern)}`;
    }

    return `[System: Context was automatically compacted to save space. Your last action was ${actionDescription}. Please continue from where you left off. Do not repeat work that was already completed - check the preserved tool results above for recent progress.]`;
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

    // Create new abort controller for this batch of tool calls
    this.toolAbortController = new AbortController();
    const signal = this.toolAbortController.signal;

    for (const toolCall of toolCalls) {
      // Check if stop was requested - break early and return partial results
      if (this.shouldStop || signal.aborted) {
        break;
      }

      // Ensure tools receive the assistant's cwd by default
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

      // Check guardrails policy if enabled
      if (this.policyEvaluator?.isEnabled()) {
        const policyResult = this.policyEvaluator.evaluateToolUse({
          toolName: toolCall.name,
          toolInput: toolCall.input as Record<string, unknown>,
          depth: this.depth,
        });

        // Handle warnings (log them - they don't block execution)
        if (policyResult.warnings.length > 0) {
          for (const warning of policyResult.warnings) {
            // Use the callback if available, otherwise warnings are silent
            this.onGuardrailsViolation?.(policyResult, toolCall.name);
          }
        }

        // If denied, block the tool call
        if (!policyResult.allowed && policyResult.action === 'deny') {
          const reason = policyResult.reasons.join('; ') || 'Blocked by guardrails policy';
          const blockedResult: ToolResult = {
            toolCallId: toolCall.id,
            content: `Tool call denied by guardrails: ${reason}`,
            isError: true,
            toolName: toolCall.name,
          };
          this.emit({ type: 'tool_result', toolResult: blockedResult });
          this.onGuardrailsViolation?.(policyResult, toolCall.name);
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

        // If requires approval, emit the need for approval
        if (policyResult.requiresApproval) {
          const reason = policyResult.reasons.join('; ') || 'Requires approval per guardrails policy';
          const approvalResult: ToolResult = {
            toolCallId: toolCall.id,
            content: `Tool call requires approval: ${reason}`,
            isError: true,
            toolName: toolCall.name,
          };
          this.emit({ type: 'tool_result', toolResult: approvalResult });
          this.onGuardrailsViolation?.(policyResult, toolCall.name);
          await this.hookExecutor.execute(this.hookLoader.getHooks('PostToolUseFailure'), {
            session_id: this.sessionId,
            hook_event_name: 'PostToolUseFailure',
            cwd: this.cwd,
            tool_name: toolCall.name,
            tool_input: toolCall.input,
            tool_result: approvalResult.content,
          });
          results.push(approvalResult);
          continue;
        }
      }

      // Check capability enforcement if enabled
      if (this.capabilityEnforcer?.isEnabled()) {
        const capResult = this.capabilityEnforcer.canUseTool(toolCall.name, {
          depth: this.depth,
          sessionId: this.sessionId,
          assistantId: this.registeredAssistantId || undefined,
        });

        // Handle warnings
        if (capResult.warnings.length > 0) {
          for (const warning of capResult.warnings) {
            this.emit({ type: 'text', content: `\n[Capability Warning] ${warning}\n` });
          }
        }

        // If not allowed, block the tool call
        if (!capResult.allowed) {
          const blockedResult: ToolResult = {
            toolCallId: toolCall.id,
            content: `Tool call denied by capabilities: ${capResult.reason}`,
            isError: true,
            toolName: toolCall.name,
          };
          this.emit({ type: 'tool_result', toolResult: blockedResult });
          this.onCapabilityViolation?.(capResult, `tool:${toolCall.name}`);
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

        // If requires approval, emit the need for approval
        if (capResult.requiresApproval) {
          const approvalResult: ToolResult = {
            toolCallId: toolCall.id,
            content: `Tool call requires approval: ${capResult.reason}`,
            isError: true,
            toolName: toolCall.name,
          };
          this.emit({ type: 'tool_result', toolResult: approvalResult });
          this.onCapabilityViolation?.(capResult, `tool:${toolCall.name}`);
          await this.hookExecutor.execute(this.hookLoader.getHooks('PostToolUseFailure'), {
            session_id: this.sessionId,
            hook_event_name: 'PostToolUseFailure',
            cwd: this.cwd,
            tool_name: toolCall.name,
            tool_input: toolCall.input,
            tool_result: approvalResult.content,
          });
          results.push(approvalResult);
          continue;
        }
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

      // If PreToolUse didn't make a decision, fire PermissionRequest hook
      // This allows hooks to auto-approve/deny or fall through to user prompt
      let finalPermissionDecision: 'allow' | 'deny' | 'ask' | undefined = preHookResult?.permissionDecision;
      if (!finalPermissionDecision && !preHookResult?.continue) {
        const permHookResult = await this.hookExecutor.execute(
          this.hookLoader.getHooks('PermissionRequest'),
          {
            session_id: this.sessionId,
            hook_event_name: 'PermissionRequest',
            cwd: this.cwd,
            tool_name: toolCall.name,
            tool_input: toolCall.input,
            permission_type: 'tool_execution',
          }
        );
        if (permHookResult?.permissionDecision) {
          finalPermissionDecision = permHookResult.permissionDecision;
        }
        // Handle PermissionRequest hook decision to deny
        if (permHookResult?.permissionDecision === 'deny' || permHookResult?.continue === false) {
          const blockedResult: ToolResult = {
            toolCallId: toolCall.id,
            content: `Tool call denied: ${permHookResult.stopReason || 'Blocked by permission hook'}`,
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
      }

      if (finalPermissionDecision === 'ask' || preHookResult?.permissionDecision === 'ask') {
        const askResult: ToolResult = {
          toolCallId: toolCall.id,
          content: `Tool call requires approval: ${preHookResult?.stopReason || 'Approval required'}`,
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

      // Execute the tool with timing
      const toolStartTime = Date.now();
      const result = await this.toolRegistry.execute(toolCall, signal);
      const toolDuration = Date.now() - toolStartTime;

      // Record tool call in budget tracker
      this.recordToolCallBudget(toolDuration);

      // If stop was triggered during tool execution, skip processing the result
      // This prevents late tool results from contaminating the conversation
      if (this.shouldStop) {
        this.pendingToolCalls.delete(toolCall.id);
        break;
      }

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

      // Update registry load after tool completion
      this.updateRegistryLoad();
    }

    // Clean up abort controller
    this.toolAbortController = null;

    return results;
  }

  /**
   * Handle slash command
   */
  private async handleCommand(message: string): Promise<CommandResult> {
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
      getMemoryManager: () => this.memoryManager,
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
      switchModel: async (modelId: string) => {
        await this.switchModel(modelId);
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
      refreshConnectors: async () => {
        const connectors = await this.connectorBridge.refresh();
        return {
          count: connectors.length,
          names: connectors.map(c => c.name),
        };
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
      budgetConfig: this.budgetConfig || undefined,
      setBudgetEnabled: (enabled: boolean) => {
        if (this.budgetTracker) {
          this.budgetTracker.setEnabled(enabled);
        } else if (enabled && this.budgetConfig) {
          // Create tracker if enabling and we have config
          this.budgetTracker = new BudgetTracker(this.sessionId, this.budgetConfig);
          this.budgetTracker.setEnabled(true);
        }
      },
      resetBudget: (scope?: BudgetScope) => {
        if (!this.budgetTracker) return;
        if (scope) {
          this.budgetTracker.resetUsage(scope);
        } else {
          this.budgetTracker.resetAll();
        }
      },
      guardrailsConfig: this.guardrailsConfig || undefined,
      setGuardrailsEnabled: (enabled: boolean) => {
        if (this.policyEvaluator) {
          this.policyEvaluator.setEnabled(enabled);
        } else if (enabled && this.guardrailsConfig) {
          // Create evaluator if enabling and we have config
          this.policyEvaluator = new PolicyEvaluator(this.guardrailsConfig);
          this.policyEvaluator.setEnabled(true);
        }
      },
      addGuardrailsPolicy: (policy) => {
        if (this.policyEvaluator) {
          this.policyEvaluator.addPolicy(policy);
        } else {
          // Create evaluator with this policy
          this.guardrailsConfig = {
            enabled: true,
            policies: [policy],
            defaultAction: 'allow',
          };
          this.policyEvaluator = new PolicyEvaluator(this.guardrailsConfig);
        }
      },
      removeGuardrailsPolicy: (policyId: string) => {
        if (this.policyEvaluator) {
          this.policyEvaluator.removePolicy(policyId);
        }
      },
      setGuardrailsDefaultAction: (action) => {
        if (this.policyEvaluator) {
          const config = this.policyEvaluator.getConfig();
          this.policyEvaluator.updateConfig({ ...config, defaultAction: action });
        }
      },
      getSwarmCoordinator: () => this.getOrCreateSwarmCoordinator(),
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
   * Emit a notification with hook support
   * Fires Notification hook first, which can suppress or modify the notification
   */
  async emitNotification(params: {
    type: string;
    title: string;
    message: string;
    priority?: 'low' | 'normal' | 'high';
  }): Promise<void> {
    // Fire Notification hook
    const hookResult = await this.hookExecutor.execute(
      this.hookLoader.getHooks('Notification'),
      {
        session_id: this.sessionId,
        hook_event_name: 'Notification',
        cwd: this.cwd,
        notification_type: params.type,
        title: params.title,
        message: params.message,
        priority: params.priority || 'normal',
      }
    );

    // If hook suppresses the notification, don't emit
    if (hookResult?.suppress) {
      return;
    }

    // Apply any modifications from hook
    const finalTitle = (hookResult?.updatedInput?.title as string) || params.title;
    const finalMessage = (hookResult?.updatedInput?.message as string) || params.message;

    // Emit the notification as a text chunk
    this.emit({ type: 'text', content: `\n[${finalTitle}] ${finalMessage}\n` });
  }

  /**
   * Stop the current processing
   */
  stop(): void {
    this.shouldStop = true;
    // Clear pending tool calls so late results don't contaminate state
    this.pendingToolCalls.clear();
    // Abort any running tool executions
    if (this.toolAbortController) {
      this.toolAbortController.abort();
      this.toolAbortController = null;
    }
    this.setHeartbeatState('stopped');
    // Emit stopped chunk so clients can drain queues
    this.emit({ type: 'stopped' });
  }

  /**
   * Shutdown background systems and timers
   */
  shutdown(): void {
    // Fire SessionEnd hook (fire-and-forget for backwards compatibility)
    this.fireSessionEndHook('shutdown').catch(() => {});

    this.shouldStop = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatManager?.stop();
    // Deregister from registry
    this.deregisterFromRegistry();
    this.energyManager?.stop();
    this.voiceManager?.stopSpeaking();
    this.voiceManager?.stopListening();
    // Stop message watching
    this.messagesManager?.stopWatching();
    // Close memory database connection
    this.memoryManager?.close();
    this.memoryManager = null;
    this.memoryInjector = null;
  }

  /**
   * Async shutdown that waits for SessionEnd hook
   */
  async shutdownAsync(reason: string = 'shutdown'): Promise<void> {
    await this.fireSessionEndHook(reason);
    this.shutdown();
  }

  /**
   * Fire SessionEnd hook with session statistics
   */
  private async fireSessionEndHook(reason: string): Promise<void> {
    const messages = this.context.getMessages();
    const tokenUsage = this.getTokenUsage();

    // Count tool calls from all messages
    let toolCallCount = 0;
    for (const msg of messages) {
      if (msg.toolCalls) {
        toolCallCount += msg.toolCalls.length;
      }
    }

    const hookInput = {
      session_id: this.sessionId,
      hook_event_name: 'SessionEnd' as const,
      cwd: this.cwd,
      reason,
      duration_ms: Date.now() - this.sessionStartTime,
      message_count: messages.length,
      tool_calls: toolCallCount,
      token_usage: {
        input: tokenUsage.inputTokens,
        output: tokenUsage.outputTokens,
        total: tokenUsage.totalTokens,
      },
    };

    await this.hookExecutor.execute(
      this.hookLoader.getHooks('SessionEnd'),
      hookInput
    );
  }

  /**
   * Get the current context
   */
  getContext(): AssistantContext {
    return this.context;
  }

  /**
   * Get current voice state
   */
  getVoiceState(): VoiceState | null {
    return this.voiceManager?.getState() ?? null;
  }

  /**
   * Get current heartbeat state
   */
  getHeartbeatState(): HeartbeatState | null {
    if (!this.heartbeatManager || this.config?.heartbeat?.enabled === false) {
      return null;
    }

    const staleThresholdMs = this.config?.heartbeat?.staleThresholdMs ?? 120000;
    const lastActivity = this.heartbeatManager.getLastActivity();
    const age = Date.now() - lastActivity;
    const stats = this.heartbeatManager.getStats();

    return {
      enabled: true,
      state: this.heartbeatManager.getState(),
      lastActivity: new Date(lastActivity).toISOString(),
      uptimeSeconds: stats.uptimeSeconds,
      isStale: age > staleThresholdMs,
    };
  }

  getAssistantManager(): AssistantManager | null {
    return this.assistantManager;
  }

  getIdentityManager(): IdentityManager | null {
    return this.identityManager;
  }

  getMessagesManager(): MessagesManager | null {
    return this.messagesManager;
  }

  getWalletManager(): WalletManager | null {
    return this.walletManager;
  }

  getSecretsManager(): SecretsManager | null {
    return this.secretsManager;
  }

  getInboxManager(): InboxManager | null {
    return this.inboxManager;
  }

  async refreshIdentityContext(): Promise<void> {
    if (this.identityManager) {
      this.identityContext = await this.identityManager.buildSystemPromptContext();
    }
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
   * Switch to a different model at runtime
   */
  private async switchModel(modelId: string): Promise<void> {
    if (!this.config) {
      throw new Error('Assistant not initialized');
    }

    // Import dynamically to avoid circular dependency
    const { getModelById, getProviderForModel } = await import('../llm/models');

    const modelDef = getModelById(modelId);
    if (!modelDef) {
      throw new Error(`Unknown model: ${modelId}. Use /model list to see available models.`);
    }

    const provider = getProviderForModel(modelId);
    if (!provider) {
      throw new Error(`Cannot determine provider for model: ${modelId}`);
    }

    // Create new LLM client with the new model
    const newConfig = {
      ...this.config.llm,
      provider,
      model: modelId,
    };

    this.llmClient = await createLLMClient(newConfig);
    this.hookExecutor.setLLMClient(this.llmClient);

    // Update config.llm to reflect the new model/provider
    // This ensures downstream consumers (summary client, reporting, etc.) see the correct model
    this.config.llm = newConfig;

    // Recompute context config with new model's context window
    // This allows expanding when switching to a larger model
    if (this.contextConfig) {
      const limits = getLimits();
      // Use config's maxContextTokens if set, otherwise use the model's context window
      const configuredMax = this.config.context?.maxContextTokens ?? modelDef.contextWindow;
      // Cap at both validation limits and model's actual context window
      const newMaxContextTokens = Math.max(
        1000,
        Math.min(configuredMax, limits.maxTotalContextTokens, modelDef.contextWindow)
      );

      this.contextConfig.maxContextTokens = newMaxContextTokens;

      // Also update targetContextTokens to stay proportional (85% of max)
      const configuredTarget = this.config.context?.targetContextTokens;
      if (!configuredTarget) {
        this.contextConfig.targetContextTokens = Math.floor(newMaxContextTokens * 0.85);
      } else {
        // Keep configured target but cap at new max
        this.contextConfig.targetContextTokens = Math.min(configuredTarget, newMaxContextTokens);
      }

      this.builtinCommands.updateTokenUsage({
        maxContextTokens: this.contextConfig.maxContextTokens,
      });
    }
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
   * Reload skills from disk
   */
  async refreshSkills(): Promise<void> {
    await this.skillLoader.loadAll(this.cwd, { includeContent: false });
  }

  /**
   * Get the skill loader (for panel operations)
   */
  getSkillLoader() {
    return this.skillLoader;
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

    // Track budget usage
    if (this.budgetTracker && (usage.inputTokens || usage.outputTokens)) {
      this.budgetTracker.recordLlmCall(
        usage.inputTokens || 0,
        usage.outputTokens || 0,
        0 // Duration tracked separately
      );
      this.checkBudgetWarnings();
    }
  }

  /**
   * Record a tool call in the budget tracker
   */
  private recordToolCallBudget(durationMs: number): void {
    if (this.budgetTracker) {
      this.budgetTracker.recordToolCall(durationMs);
      this.checkBudgetWarnings();
    }
  }

  /**
   * Check budget limits and emit warnings
   */
  private checkBudgetWarnings(): void {
    if (!this.budgetTracker || !this.budgetTracker.isEnabled()) return;

    let sessionStatus = this.budgetTracker.checkBudget('session');
    let exceeded = sessionStatus.overallExceeded;

    // Collect all warnings
    const warnings: string[] = [];
    for (const [_metric, check] of Object.entries(sessionStatus.checks)) {
      if (check?.warning) {
        warnings.push(check.warning);
      }
    }

    // Also check project budget if active
    if (this.budgetTracker.getActiveProject()) {
      const projectStatus = this.budgetTracker.checkBudget('project');
      for (const [_metric, check] of Object.entries(projectStatus.checks)) {
        if (check?.warning) {
          warnings.push(`[project] ${check.warning}`);
        }
      }
      if (projectStatus.overallExceeded) {
        exceeded = true;
      }
    }

    // Emit warnings
    if (warnings.length > 0) {
      this.onBudgetWarning?.(warnings.join('; '));
    }

    // Check if exceeded and handle based on onExceeded config
    if (exceeded) {
      const onExceeded = this.budgetConfig?.onExceeded || 'warn';
      if (onExceeded === 'stop') {
        this.onBudgetWarning?.('Budget exceeded - stopping assistant');
        this.stop();
      } else if (onExceeded === 'pause') {
        this.onBudgetWarning?.('Budget exceeded - pausing (requires /budget resume to continue)');
        this.paused = true;
      }
    }
  }

  /**
   * Check if budget is exceeded (can be used before starting a turn)
   */
  isBudgetExceeded(): boolean {
    if (!this.budgetTracker || !this.budgetTracker.isEnabled()) return false;
    return this.budgetTracker.isAnyExceeded();
  }

  /**
   * Check if the assistant is currently paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Resume from budget pause
   */
  resume(): void {
    if (this.paused) {
      this.paused = false;
      if (this.pauseResolve) {
        this.pauseResolve();
      }
    }
  }

  /**
   * Get current budget status
   */
  getBudgetStatus() {
    if (!this.budgetTracker) return null;
    return this.budgetTracker.getSummary();
  }

  /**
   * Check if assistant is currently running
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
    if (this.budgetTracker) {
      this.budgetTracker.setActiveProject(projectId);
    }
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

  private startAssistantHeartbeat(): void {
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
      // Also send heartbeat to registry
      if (this.registeredAssistantId && this.registryService) {
        this.registryService.heartbeat(this.registeredAssistantId);
      }
    });

    this.heartbeatManager.start(this.sessionId);
    this.heartbeatManager.setState('idle');
    void this.checkRecovery();

    // Register assistant in registry
    this.registerInRegistry();
  }

  /**
   * Register this assistant in the global registry
   */
  private registerInRegistry(): void {
    try {
      this.registryService = getGlobalRegistry();
      if (!this.registryService.isEnabled()) return;

      // Cleanup stale assistants on startup (from previous crashed sessions)
      this.registryService.cleanupStaleAssistants();

      // Determine assistant type based on depth
      const assistantType: AssistantType = this.depth > 0 ? 'subassistant' : 'assistant';

      // Get tools and skills for capability registration
      const tools = this.toolRegistry.getTools().map((t: Tool) => t.name);
      const skills = this.skillLoader.getSkills().map((s) => s.name);

      // Register the assistant
      const assistantName = this.assistantManager?.getActive()?.name ||
        this.identityManager?.getActive()?.profile?.displayName ||
        `Assistant ${this.sessionId.slice(0, 8)}`;
      const registered = this.registryService.register({
        id: `assistant_${this.sessionId}`,
        name: assistantName,
        type: assistantType,
        sessionId: this.sessionId,
        capabilities: {
          tools,
          skills,
          models: [this.config?.llm?.model || 'claude-sonnet-4-20250514'],
          tags: this.depth > 0 ? ['subassistant'] : ['main'],
          maxConcurrent: 5,
          maxDepth: this.config?.subassistants?.maxDepth ?? 3,
        },
        metadata: {
          cwd: this.cwd,
          assistantId: this.assistantId,
          depth: this.depth,
        },
      });

      this.registeredAssistantId = registered.id;
    } catch {
      // Registry registration failed, non-critical
    }
  }

  /**
   * Deregister this assistant from the global registry
   */
  private deregisterFromRegistry(): void {
    if (!this.registeredAssistantId || !this.registryService) return;

    try {
      this.registryService.deregister(this.registeredAssistantId);
      this.registeredAssistantId = null;
    } catch {
      // Deregistration failed, non-critical
    }
  }

  /**
   * Update assistant status in registry
   */
  private updateRegistryStatus(state: AssistantState, taskDescription?: string): void {
    if (!this.registeredAssistantId || !this.registryService) return;

    try {
      this.registryService.updateStatus(this.registeredAssistantId, {
        state,
        currentTask: state === 'processing' ? 'processing_message' : undefined,
        taskDescription,
        uptime: Math.floor((Date.now() - this.sessionStartTime) / 1000),
      });
    } catch {
      // Status update failed, non-critical
    }
  }

  /**
   * Update assistant load in registry
   */
  private updateRegistryLoad(): void {
    if (!this.registeredAssistantId || !this.registryService) return;

    try {
      const stats = this.builtinCommands.getTokenUsage();
      this.registryService.updateLoad(this.registeredAssistantId, {
        activeTasks: this.pendingToolCalls.size,
        tokensUsed: stats.inputTokens + stats.outputTokens,
        currentDepth: this.depth,
      });
    } catch {
      // Load update failed, non-critical
    }
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

  private setHeartbeatState(state: AssistantState): void {
    this.heartbeatManager?.setState(state);
    // Also update registry
    this.updateRegistryStatus(state);
    // Update load when state changes
    if (state === 'processing') {
      this.updateRegistryLoad();
    }
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

  /**
   * Inject relevant memories into context at turn start
   */
  private async injectMemoryContext(userMessage: string): Promise<void> {
    if (!this.memoryInjector || !this.memoryInjector.isEnabled()) return;

    try {
      // Remove previous memory context if it exists
      if (this.pendingMemoryContext) {
        const previous = this.pendingMemoryContext.trim();
        this.context.removeSystemMessages((content) => content.trim() === previous);
        this.pendingMemoryContext = null;
      }

      // Prepare new memory injection based on user's message
      const result = await this.memoryInjector.prepareInjection(userMessage);
      if (result.content) {
        this.pendingMemoryContext = result.content;
        // Memory context will be added via buildSystemPrompt
      }
    } catch (error) {
      // Log but don't fail - memory injection is non-critical
      console.error('Failed to inject memory context:', error);
      this.pendingMemoryContext = null;
    }
  }

  /**
   * Inject environment context (datetime, cwd, project, etc.) at turn start
   */
  private async injectContextInfo(): Promise<void> {
    if (!this.contextInjector || !this.contextInjector.isEnabled()) return;

    try {
      // Remove previous context injection if it exists
      if (this.pendingContextInjection) {
        const previous = this.pendingContextInjection.trim();
        this.context.removeSystemMessages((content) => content.trim() === previous);
        this.pendingContextInjection = null;
      }

      // Prepare new context injection
      const result = await this.contextInjector.prepareInjection();
      if (result.content) {
        this.pendingContextInjection = result.content;
        // Context injection will be added via buildSystemPrompt
      }
    } catch (error) {
      // Log but don't fail - context injection is non-critical
      console.error('Failed to inject context info:', error);
      this.pendingContextInjection = null;
    }
  }

  private startHeartbeat(): void {
    if (!this.config) return;
    if (this.config.scheduler?.enabled === false) return;
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
          // Determine what content to run based on action type
          // 'message' type injects custom message into assistant session
          // 'command' type (or undefined for backwards compatibility) runs the command
          const contentToRun = current.actionType === 'message'
            ? (current.message || current.command)
            : current.command;
          const result = await this.runMessage(contentToRun, 'schedule');
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
    this.context = new AssistantContext(maxMessages);

    // Clear pending injections to prevent stale context
    this.pendingContextInjection = null;
    this.pendingMemoryContext = null;

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

    const autoRefreshContext = ConnectorAutoRefreshManager.getInstance()
      .buildPromptSection(this.connectorBridge.getConnectors());
    if (autoRefreshContext) {
      parts.push(autoRefreshContext);
    }

    // Add context injection if available (datetime, cwd, project, etc.)
    if (this.pendingContextInjection) {
      parts.push(this.pendingContextInjection);
    }

    // Add memory injection if available
    if (this.pendingMemoryContext) {
      parts.push(this.pendingMemoryContext);
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
   * Initialize the subassistant manager for spawning child assistants
   */
  private initializeSubassistantManager(): void {
    const context: SubassistantManagerContext = {
      createSubassistantLoop: (config: SubassistantLoopConfig) => this.createSubassistantLoop(config),
      getTools: () => this.toolRegistry.getTools(),
      getParentAllowedTools: () => this.getEffectiveAllowedTools(),
      getLLMClient: () => this.llmClient,
      fireHook: async (input) => {
        // Fire SubassistantStart/SubassistantStop hooks
        const hooks = this.hookLoader.getHooks(input.hook_event_name);
        return this.hookExecutor.execute(hooks, input);
      },
    };

    // Use subassistant config from AssistantsConfig, with fallbacks to defaults
    const subassistantConfig = this.config?.subassistants ?? {};

    this.subassistantManager = new SubassistantManager(
      {
        maxDepth: subassistantConfig.maxDepth,
        maxConcurrent: subassistantConfig.maxConcurrent,
        maxTurns: subassistantConfig.maxTurns,
        defaultTimeoutMs: subassistantConfig.defaultTimeoutMs,
        defaultTools: subassistantConfig.defaultTools,
        forbiddenTools: subassistantConfig.forbiddenTools,
      },
      context
    );
  }

  /**
   * Get or create the swarm coordinator for multi-assistant orchestration
   */
  private getOrCreateSwarmCoordinator(): SwarmCoordinator | null {
    if (!this.subassistantManager) {
      return null;
    }

    if (!this.swarmCoordinator) {
      const context: SwarmCoordinatorContext = {
        subassistantManager: this.subassistantManager,
        registry: this.registryService ?? undefined,
        sessionId: this.sessionId,
        cwd: this.cwd,
        depth: this.depth,
        onChunk: this.onChunk,
        getAvailableTools: () => this.toolRegistry.getTools().map(t => t.name),
      };

      this.swarmCoordinator = new SwarmCoordinator({}, context);
    }

    return this.swarmCoordinator;
  }

  /**
   * Create a subassistant loop for spawning
   */
  private async createSubassistantLoop(config: SubassistantLoopConfig): Promise<{
    run: () => Promise<SubassistantResult>;
    stop: () => void;
  }> {
    let response = '';
    let turns = 0;
    let toolCalls = 0;
    let stopped = false;

    const subassistant = new AssistantLoop({
      cwd: config.cwd,
      sessionId: config.sessionId,
      allowedTools: config.tools,
      depth: config.depth,
      llmClient: config.llmClient,
      extraSystemPrompt: `You are a subassistant spawned to complete a specific task.

Task: ${config.task}

${config.context ? `Context:\n${config.context}\n\n` : ''}
Complete this task and provide a clear summary of what you found or accomplished.
Be concise but thorough. Focus only on this task.`,
      onChunk: (chunk) => {
        if (chunk.type === 'text' && chunk.content) {
          response += chunk.content;
        }
        if (chunk.type === 'tool_use') {
          toolCalls++;
        }
        config.onChunk?.(chunk);
      },
    });

    await subassistant.initialize();

    return {
      run: async (): Promise<SubassistantResult> => {
        try {
          // Process the task - process() already handles the full assistant loop
          // including tool calls and multi-turn conversation internally
          await subassistant.process(config.task);

          // Count actual turns from messages
          const messages = subassistant.getContext().getMessages();
          turns = messages.filter((m) => m.role === 'assistant').length;

          // Get token usage from subassistant
          const usage = subassistant.getTokenUsage();
          const tokensUsed = usage.inputTokens + usage.outputTokens;

          return {
            success: true,
            result: response.trim(),
            turns,
            toolCalls,
            tokensUsed,
          };
        } catch (error) {
          // Get token usage even on error
          const usage = subassistant.getTokenUsage();
          const tokensUsed = usage.inputTokens + usage.outputTokens;

          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            turns,
            toolCalls,
            tokensUsed,
          };
        } finally {
          subassistant.shutdown();
        }
      },
      stop: () => {
        stopped = true;
        subassistant.stop();
      },
    };
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

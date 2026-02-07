// Core exports for assistants

// Runtime
export { setRuntime, getRuntime, hasRuntime } from './runtime';
export type { Runtime, FileHandle, SpawnOptions, SpawnResult, ShellResult, ShellCommand, GlobOptions, DatabaseConnection, DatabaseStatement } from './runtime';

// Assistant
export { AssistantLoop } from './agent/loop';
export { AssistantContext } from './agent/context';
export { SubassistantManager } from './agent/subagent-manager';
export { StatsTracker } from './agent/stats';
export type {
  SubassistantConfig,
  SubassistantResult,
  SubassistantInfo,
  SubassistantJob,
  SubassistantJobStatus,
  SubassistantManagerConfig,
  SubassistantManagerContext,
  SubassistantLoopConfig,
  SubassistantRunner,
} from './agent/subagent-manager';
export type { ToolStats, SessionStats } from './agent/stats';

// Tools
export { ToolRegistry } from './tools/registry';
export { ConnectorAutoRefreshManager } from './connectors/auto-refresh';
export type { ConnectorAutoRefreshEntry, ConnectorAutoRefreshSchedule } from './connectors/auto-refresh';
export {
  ConnectorBridge,
  connectorExecuteTool,
  createConnectorExecuteExecutor,
  registerConnectorExecuteTool,
  connectorsSearchTool,
  createConnectorsSearchExecutor,
  registerConnectorsSearchTool,
  connectorsListTool,
  createConnectorsListExecutor,
  registerConnectorsListTool,
} from './tools/connector';
export {
  connectorAutoRefreshTool,
  createConnectorAutoRefreshExecutor,
  registerConnectorAutoRefreshTool,
} from './tools/connector-refresh';
export type {
  ConnectorExecuteContext,
  ConnectorSearchContext,
  ConnectorListContext,
} from './tools/connector';
export { ConnectorIndex } from './tools/connector-index';
export type { IndexedConnector } from './tools/connector-index';
export { BashTool } from './tools/bash';
export { FilesystemTools } from './tools/filesystem';
export { WebTools } from './tools/web';
export { FeedbackTool } from './tools/feedback';
export { SchedulerTool, createSchedulerTool, registerSchedulerTools, type SchedulerContext } from './tools/scheduler';
export { WaitTool, SleepTool } from './tools/wait';
export {
  projectTools,
  planTools,
  projectAndPlanTools,
  registerProjectTools,
  createProjectToolExecutors,
  type ProjectToolContext,
} from './tools/projects';
export {
  taskTools,
  tasksListTool,
  tasksGetTool,
  tasksAddTool,
  tasksNextTool,
  tasksCompleteTool,
  tasksFailTool,
  tasksStatusTool,
  createTaskToolExecutors,
  registerTaskTools,
  type TasksToolContext,
} from './tools/tasks';
export {
  selfAwarenessTools,
  contextGetTool,
  contextStatsTool,
  whoamiTool,
  identityGetTool,
  energyStatusTool,
  resourceLimitsTool,
  createSelfAwarenessToolExecutors,
  registerSelfAwarenessTools,
  type SelfAwarenessContext,
} from './tools/self-awareness';
export {
  assistantTools,
  assistantSpawnTool,
  assistantListTool,
  assistantDelegateTool,
  assistantJobStatusTool,
  createAssistantToolExecutors,
  registerAssistantTools,
  type AssistantToolContext,
} from './tools/agents';
export {
  ToolIndex,
  toolsSearchTool,
  createToolsSearchExecutor,
  registerToolsSearchTool,
} from './tools/search';
export type { ToolMetadata, ToolsSearchContext } from './tools/search';
export {
  assistantRegistryTools,
  registryListTool,
  registryQueryTool,
  registryGetTool,
  registryStatsTool,
  createAssistantRegistryToolExecutors,
  registerAssistantRegistryTools,
} from './tools/agent-registry';
export type { RegistryToolContext } from './tools/agent-registry';
export {
  capabilityTools,
  capabilitiesGetTool,
  capabilitiesStatusTool,
  capabilitiesCheckTool,
  createCapabilityToolExecutors,
  registerCapabilityTools,
} from './tools/capabilities';
export type { CapabilityToolContext } from './tools/capabilities';
export {
  swarmTools,
  swarmExecuteTool,
  swarmStatusTool,
  swarmStopTool,
  createSwarmToolExecutors,
  registerSwarmTools,
} from './tools/swarm';
export type { SwarmToolContext } from './tools/swarm';

// Commands
export { CommandLoader, CommandExecutor, BuiltinCommands } from './commands';
export type { Command, CommandContext, CommandResult, TokenUsage } from './commands';

// Skills
export { SkillLoader } from './skills/loader';
export { SkillExecutor } from './skills/executor';
export { createSkill } from './skills/create';

// Hooks
export { HookLoader } from './hooks/loader';
export { HookExecutor } from './hooks/executor';
export { NativeHookRegistry, nativeHookRegistry } from './hooks/native';
export { ScopeContextManager } from './hooks/scope-context';
export { createScopeVerificationHook, scopeVerificationHandler } from './hooks/scope-verification';
export { HookStore } from './hooks/store';
export { HookTester } from './hooks/tester';
export { HookLogger } from './hooks/logger';
export type { HookLocation, HookInfo } from './hooks/store';
export type { HookTestResult } from './hooks/tester';
export type { HookLogEntry } from './hooks/logger';

// Verification Sessions
export { VerificationSessionStore } from './sessions/verification';

// Memory
export { MemoryStore } from './memory/store';
export { SessionManager } from './memory/sessions';
export { GlobalMemoryManager } from './memory/global-memory';
export { MemoryInjector, buildContextInjection } from './memory/injector';
export type {
  MemoryScope,
  MemoryCategory,
  MemorySource,
  Memory,
  MemoryOptions,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStats,
  MemoryInjectionConfig,
  MemoryInjectionResult,
  MemoryAccessAction,
  MemoryAccessLog,
  MemoryConfig,
} from './memory/types';
export { DEFAULT_MEMORY_CONFIG } from './memory/types';
export {
  memoryTools,
  memorySaveTool,
  memoryRecallTool,
  memoryForgetTool,
  memoryListTool,
  memoryUpdateTool,
  memoryStatsTool,
  createMemoryToolExecutors,
  registerMemoryTools,
} from './tools/memory';
export type { MemoryToolContext } from './tools/memory';
export {
  voiceTools,
  voiceEnableTool,
  voiceDisableTool,
  voiceStatusTool,
  voiceSayTool,
  voiceListenTool,
  voiceStopTool,
  createVoiceToolExecutors,
  registerVoiceTools,
} from './tools/voice';
export type { VoiceToolContext } from './tools/voice';

// Context
export * from './context';

// Heartbeat
export * from './heartbeat';

// Energy
export * from './energy';

// Budget
export {
  BudgetTracker,
  DEFAULT_BUDGET_CONFIG,
  DEFAULT_SESSION_LIMITS,
  DEFAULT_ASSISTANT_LIMITS,
  DEFAULT_SWARM_LIMITS,
  WARNING_THRESHOLD,
} from './budget';
export type { BudgetScope, BudgetCheckResult, BudgetStatus, BudgetUpdate } from './budget';

// Voice
export * from './voice/types';
export { VoiceManager } from './voice/manager';
export { AudioPlayer } from './voice/player';
export { AudioRecorder } from './voice/recorder';
export { WhisperSTT, ElevenLabsSTT, SystemSTT } from './voice/stt';
export { ElevenLabsTTS, SystemTTS } from './voice/tts';

// Identity
export * from './identity';

// Migration
export * from './migration';

// LLM
export type { LLMClient } from './llm/client';
export { createLLMClient, ProviderMismatchError } from './llm/client';
export { AnthropicClient } from './llm/anthropic';
export { OpenAIClient } from './llm/openai';
export {
  MODELS,
  getModelById,
  getModelsByProvider,
  getProviderForModel,
  isValidModel,
  getAllModelIds,
  getModelDisplayName,
  formatModelInfo,
  getModelsGroupedByProvider,
} from './llm/models';
export type { ModelDefinition } from './llm/models';

// Config
export { loadConfig, getConfigPath, getConfigDir, getProjectConfigDir } from './config';

// Inbox
export * from './inbox';

// Wallet
export * from './wallet';

// Secrets
export * from './secrets';

// Scheduler
export * from './scheduler';

// Jobs
export * from './jobs';

// Messages (Assistant-to-Assistant)
export * from './messages';

// Client
export { EmbeddedClient } from './client';

// Sessions
export { SessionRegistry } from './sessions/registry';
export type { SessionInfo, PersistedSession, CreateSessionOptions } from './sessions/registry';
export { SessionStore, type PersistedSessionData } from './sessions/store';
export {
  sessionTools,
  sessionInfoTool,
  sessionListTool,
  sessionCreateTool,
  sessionUpdateTool,
  sessionDeleteTool,
  createSessionToolExecutors,
  registerSessionTools,
} from './sessions';
export type {
  SessionContext,
  SessionQueryFunctions,
  AssistantSessionData,
  SessionMetadata as SessionToolMetadata,
  ListSessionsOptions,
  CreateSessionData,
  UpdateSessionData,
} from './sessions';

// Logger
export { Logger, SessionStorage, initAssistantsDir } from './logger';
export type { SessionData, SavedSessionInfo } from './logger';

// History
export * from './history';

// Projects
export * from './projects';

// Tasks
export * from './tasks';

// Errors
export * from './errors';

// Utils
export * from './utils/retry';

// Validation
export * from './validation';

// Security
export * from './security';

// Guardrails
export * from './guardrails';

// Registry
export * from './registry';

// Capabilities
export * from './capabilities';

// Swarm
export * from './swarm';

// Workspace (shared workspaces for agent collaboration)
export * from './workspace';

// Features (runtime feature detection)
export * from './features';

// Re-export commonly used shared types (avoid duplicates with local definitions)
export type {
  Tool,
  ToolCall,
  ToolResult,
  Message,
  TokenUsage as SharedTokenUsage,
  EnergyState,
  HookEvent,
  HookConfig,
  HookMatcher,
  HookInput,
  HookOutput,
  NativeHook,
  NativeHookHandler,
  NativeHookConfig,
  ScopeContext,
  VerificationSession,
  VerificationResult,
  GoalAnalysis,
  DocumentAttachment,
  DocumentSource,
  ConnectorsConfigShared,
} from '@hasna/assistants-shared';

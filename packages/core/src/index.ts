// Core exports for assistants

// Runtime
export { setRuntime, getRuntime, hasRuntime } from './runtime';
export type { Runtime, FileHandle, SpawnOptions, SpawnResult, ShellResult, ShellCommand, GlobOptions, DatabaseConnection, DatabaseStatement } from './runtime';

// Agent
export { AgentLoop } from './agent/loop';
export { AgentContext } from './agent/context';

// Tools
export { ToolRegistry } from './tools/registry';
export { ConnectorBridge } from './tools/connector';
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

// Verification Sessions
export { VerificationSessionStore } from './sessions/verification';

// Memory
export { MemoryStore } from './memory/store';
export { SessionManager } from './memory/sessions';

// Context
export * from './context';

// Heartbeat
export * from './heartbeat';

// Energy
export * from './energy';

// Voice
export * from './voice/types';
export { VoiceManager } from './voice/manager';
export { AudioPlayer } from './voice/player';
export { AudioRecorder } from './voice/recorder';
export { WhisperSTT, SystemSTT } from './voice/stt';
export { ElevenLabsTTS, SystemTTS } from './voice/tts';

// Identity
export * from './identity';

// Migration
export * from './migration';

// LLM
export type { LLMClient } from './llm/client';
export { createLLMClient } from './llm/client';
export { AnthropicClient } from './llm/anthropic';

// Config
export { loadConfig, getConfigPath } from './config';

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

// Messages (Agent-to-Agent)
export * from './messages';

// Client
export { EmbeddedClient } from './client';

// Sessions
export { SessionRegistry } from './sessions/registry';
export type { SessionInfo, PersistedSession } from './sessions/registry';
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
  AgentSessionData,
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
} from '@hasna/assistants-shared';

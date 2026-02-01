// Core exports for assistants

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
export { SchedulerTool } from './tools/scheduler';

// Commands
export { CommandLoader, CommandExecutor, BuiltinCommands } from './commands';
export type { Command, CommandContext, CommandResult, TokenUsage } from './commands';

// Skills
export { SkillLoader } from './skills/loader';
export { SkillExecutor } from './skills/executor';

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

// Scheduler
export * from './scheduler';

// Client
export { EmbeddedClient } from './client';

// Sessions
export { SessionRegistry } from './sessions/registry';
export type { SessionInfo, PersistedSession } from './sessions/registry';

// Logger
export { Logger, SessionStorage, initAssistantsDir } from './logger';
export type { SessionData, SavedSessionInfo } from './logger';

// Errors
export * from './errors';

// Utils
export * from './utils/retry';

// Validation
export * from './validation';

// Security
export * from './security';

// Errors
export * from './errors';

// Re-export shared types
export * from '@hasna/assistants-shared';

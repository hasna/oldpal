// Core exports for oldpal

// Agent
export { AgentLoop } from './agent/loop';
export { AgentContext } from './agent/context';

// Tools
export { ToolRegistry } from './tools/registry';
export { ConnectorBridge } from './tools/connector';
export { BashTool } from './tools/bash';
export { FilesystemTools } from './tools/filesystem';
export { WebTools } from './tools/web';

// Commands
export { CommandLoader, CommandExecutor, BuiltinCommands } from './commands';
export type { Command, CommandContext, CommandResult, TokenUsage } from './commands';

// Skills
export { SkillLoader } from './skills/loader';
export { SkillExecutor } from './skills/executor';

// Hooks
export { HookLoader } from './hooks/loader';
export { HookExecutor } from './hooks/executor';

// Memory
export { MemoryStore } from './memory/store';
export { SessionManager } from './memory/sessions';

// LLM
export type { LLMClient } from './llm/client';
export { createLLMClient } from './llm/client';
export { AnthropicClient } from './llm/anthropic';

// Config
export { loadConfig, getConfigPath } from './config';

// Client
export { EmbeddedClient } from './client';

// Logger
export { Logger, SessionStorage, initOldpalDir } from './logger';

// Re-export shared types
export * from '@oldpal/shared';

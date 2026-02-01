// ============================================
// Message Types
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done' | 'usage' | 'exit';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxContextTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// ============================================
// Tool Types
// ============================================

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required?: string[];
}

export interface ToolProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ToolProperty;
  default?: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
  toolName?: string;
}

// ============================================
// Connector Types
// ============================================

export interface Connector {
  name: string;
  cli: string;
  description: string;
  commands: ConnectorCommand[];
  auth?: ConnectorAuth;
}

export interface ConnectorCommand {
  name: string;
  description: string;
  args: ConnectorArg[];
  options: ConnectorOption[];
}

export interface ConnectorArg {
  name: string;
  description?: string;
  required?: boolean;
}

export interface ConnectorOption {
  name: string;
  description?: string;
  type: 'string' | 'number' | 'boolean';
  default?: unknown;
  alias?: string;
}

export interface ConnectorAuth {
  type: 'oauth2' | 'api_key' | 'none';
  statusCommand?: string;
}

// ============================================
// Skill Types
// ============================================

export interface Skill {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  model?: string;
  context?: 'fork';
  agent?: string;
  hooks?: HookConfig;
  content: string;
  filePath: string;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'argument-hint'?: string;
  'allowed-tools'?: string;
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  model?: string;
  context?: 'fork';
  agent?: string;
  hooks?: HookConfig;
  [key: string]: unknown;  // Allow additional properties
}

// ============================================
// Hook Types
// ============================================

export type HookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Stop';

export interface HookConfig {
  [event: string]: HookMatcher[];
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookHandler[];
}

export interface HookHandler {
  type: 'command' | 'prompt' | 'agent';
  command?: string;
  prompt?: string;
  model?: string;
  timeout?: number;
  async?: boolean;
  statusMessage?: string;
}

export interface HookInput {
  session_id: string;
  hook_event_name: HookEvent;
  cwd: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt?: string;
  [key: string]: unknown;
}

export interface HookOutput {
  continue?: boolean;
  stopReason?: string;
  systemMessage?: string;
  additionalContext?: string;
  permissionDecision?: 'allow' | 'deny' | 'ask';
  updatedInput?: Record<string, unknown>;
}

// ============================================
// Session Types
// ============================================

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  metadata?: Record<string, unknown>;
}

// ============================================
// Multi-Session Types
// ============================================

export interface SessionInfo {
  id: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  isProcessing: boolean;
}

// ============================================
// Config Types
// ============================================

export interface OldpalConfig {
  llm: LLMConfig;
  voice?: VoiceConfig;
  connectors?: string[];
  skills?: string[];
  hooks?: HookConfig;
  scheduler?: SchedulerConfig;
}

export interface LLMConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey?: string;
  maxTokens?: number;
}

export interface VoiceConfig {
  enabled: boolean;
  stt: STTConfig;
  tts: TTSConfig;
  wake?: WakeConfig;
}

export interface STTConfig {
  provider: 'whisper';
  model?: string;
  language?: string;
}

export interface TTSConfig {
  provider: 'elevenlabs';
  voiceId: string;
  model?: string;
}

export interface WakeConfig {
  enabled: boolean;
  word: string;
}

export interface SchedulerConfig {
  enabled?: boolean;
  heartbeatIntervalMs?: number;
}

// ============================================
// Scheduler Types
// ============================================

export interface ScheduledCommand {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: 'user' | 'agent';
  command: string;
  description?: string;
  status: 'active' | 'paused' | 'completed' | 'error';
  schedule: {
    kind: 'once' | 'cron';
    at?: string;
    cron?: string;
    timezone?: string;
  };
  nextRunAt?: number;
  lastRunAt?: number;
  lastResult?: {
    ok: boolean;
    summary?: string;
    error?: string;
  };
}

// ============================================
// Client Types
// ============================================

export interface AssistantClient {
  send(message: string): Promise<void>;
  onChunk(callback: (chunk: StreamChunk) => void): void;
  onError(callback: (error: Error) => void): void;
  getTools(): Promise<Tool[]>;
  getSkills(): Promise<Skill[]>;
  stop(): void;
  disconnect(): void;
}

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
  documents?: DocumentAttachment[];
}

// ============================================
// Document Types (PDF support)
// ============================================

export interface DocumentAttachment {
  type: 'pdf';
  source: DocumentSource;
  name?: string;
}

export type DocumentSource =
  | { type: 'base64'; mediaType: string; data: string }
  | { type: 'url'; url: string }
  | { type: 'file'; fileId: string };

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
// Native Hook Types
// ============================================

/**
 * Native hook handler function type
 */
export type NativeHookHandler = (
  input: HookInput,
  context: NativeHookContext
) => Promise<HookOutput | null>;

/**
 * Native hook definition - system hooks that cannot be deleted
 */
export interface NativeHook {
  id: string;
  event: HookEvent;
  priority: number; // Lower = runs first
  handler: NativeHookHandler;
  enabled?: boolean;
}

/**
 * Context passed to native hooks
 */
export interface NativeHookContext {
  sessionId: string;
  cwd: string;
  messages: Message[];
  scopeContext?: ScopeContext;
  llmClient?: unknown; // LLMClient type from core
  config?: NativeHookConfig;
}

/**
 * Configuration for native hooks
 */
export interface NativeHookConfig {
  scopeVerification?: ScopeVerificationConfig;
}

/**
 * Configuration for scope verification feature
 */
export interface ScopeVerificationConfig {
  enabled?: boolean;
  maxRetries?: number;
  excludePatterns?: string[];
}

// ============================================
// Scope Context Types
// ============================================

/**
 * Tracks user's intent/goals for the current session
 */
export interface ScopeContext {
  originalMessage: string;
  extractedGoals: string[];
  timestamp: number;
  verificationAttempts: number;
  maxAttempts: number;
}

// ============================================
// Verification Session Types
// ============================================

/**
 * Goal analysis result from verification
 */
export interface GoalAnalysis {
  goal: string;
  met: boolean;
  evidence: string;
}

/**
 * Result of scope verification
 */
export interface VerificationResult {
  goalsMet: boolean;
  goalsAnalysis: GoalAnalysis[];
  reason: string;
  suggestions?: string[];
}

/**
 * Stored verification session for user visibility
 */
export interface VerificationSession {
  id: string;
  parentSessionId: string;
  type: 'scope-verification';
  result: 'pass' | 'fail' | 'force-continue';
  goals: string[];
  reason: string;
  suggestions?: string[];
  verificationResult: VerificationResult;
  createdAt: string;
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

export interface AssistantsConfig {
  llm: LLMConfig;
  voice?: VoiceConfig;
  connectors?: string[];
  skills?: string[];
  hooks?: HookConfig;
  scheduler?: SchedulerConfig;
  heartbeat?: HeartbeatConfig;
  context?: ContextConfig;
  energy?: EnergyConfig;
  validation?: ValidationConfig;
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
  autoListen?: boolean;
}

export interface STTConfig {
  provider: 'whisper' | 'system';
  model?: string;
  language?: string;
}

export interface TTSConfig {
  provider: 'elevenlabs' | 'system';
  voiceId?: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
  speed?: number;
}

export interface WakeConfig {
  enabled: boolean;
  word: string;
}

export interface VoiceState {
  enabled: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  sttProvider?: string;
  ttsProvider?: string;
}

// ============================================
// Identity & Assistant Types
// ============================================

export interface AssistantSettings {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPromptAddition?: string;
  enabledTools?: string[];
  disabledTools?: string[];
  skillDirectories?: string[];
}

export interface Assistant {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  defaultIdentityId?: string;
  settings: AssistantSettings;
  createdAt: string;
  updatedAt: string;
}

export interface ContactEntry {
  value: string;
  label: string;
  isPrimary?: boolean;
}

export interface AddressEntry {
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  label: string;
}

export interface SocialEntry {
  platform: string;
  value: string;
  label?: string;
}

export interface IdentityProfile {
  displayName: string;
  title?: string;
  company?: string;
  bio?: string;
  timezone: string;
  locale: string;
}

export interface IdentityContacts {
  emails: ContactEntry[];
  phones: ContactEntry[];
  addresses: AddressEntry[];
  social?: SocialEntry[];
}

export interface IdentityPreferences {
  language: string;
  dateFormat: string;
  communicationStyle: 'formal' | 'casual' | 'professional';
  responseLength: 'concise' | 'detailed' | 'balanced';
  codeStyle?: {
    indentation: 'tabs' | 'spaces';
    indentSize: number;
    quoteStyle: 'single' | 'double';
  };
  custom: Record<string, unknown>;
}

export interface Identity {
  id: string;
  name: string;
  isDefault: boolean;
  profile: IdentityProfile;
  contacts: IdentityContacts;
  preferences: IdentityPreferences;
  context?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveIdentityInfo {
  assistant: Assistant | null;
  identity: Identity | null;
}

export interface SchedulerConfig {
  enabled?: boolean;
  heartbeatIntervalMs?: number;
}

export interface HeartbeatConfig {
  enabled?: boolean;
  intervalMs?: number;
  staleThresholdMs?: number;
  persistPath?: string;
}

export interface ContextConfig {
  enabled?: boolean;
  maxContextTokens?: number;
  targetContextTokens?: number;
  summaryTriggerRatio?: number;
  keepRecentMessages?: number;
  keepSystemPrompt?: boolean;
  summaryStrategy?: 'llm' | 'hybrid';
  summaryModel?: string;
  summaryMaxTokens?: number;
  maxMessages?: number;
}

export interface EnergyCosts {
  message: number;
  toolCall: number;
  llmCall: number;
  longContext: number;
}

export interface EnergyConfig {
  enabled?: boolean;
  costs?: Partial<EnergyCosts>;
  regenRate?: number;
  lowEnergyThreshold?: number;
  criticalThreshold?: number;
  maxEnergy?: number;
}

export interface EnergyState {
  current: number;
  max: number;
  regenRate: number;
  lastUpdate: string;
}

export interface ValidationConfig {
  mode?: 'strict' | 'lenient';
  maxUserMessageLength?: number;
  maxToolOutputLength?: number;
  maxTotalContextTokens?: number;
  maxFileReadSize?: number;
  perTool?: Record<string, { mode?: 'strict' | 'lenient'; maxOutputLength?: number }>;
}

// ============================================
// Scheduler Types
// ============================================

export interface ScheduledCommand {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: 'user' | 'agent';
  sessionId?: string;
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
  getEnergyState(): EnergyState | null;
  getVoiceState(): VoiceState | null;
  getIdentityInfo(): ActiveIdentityInfo | null;
  stop(): void;
  disconnect(): void;
}

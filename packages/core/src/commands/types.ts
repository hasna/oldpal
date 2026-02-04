import type { Tool, TokenUsage, EnergyState, VoiceState } from '@hasna/assistants-shared';
import type { RecordOptions } from '../voice/recorder';
import type { ErrorStats } from '../errors';
import type { ContextInfo, ContextProcessResult } from '../context';
import type { AssistantManager, IdentityManager } from '../identity';
import type { InboxManager } from '../inbox';
import type { WalletManager } from '../wallet';
import type { SecretsManager } from '../secrets';
import type { MessagesManager } from '../messages';

// Re-export TokenUsage from shared
export type { TokenUsage } from '@hasna/assistants-shared';

/**
 * Command definition loaded from a markdown file
 */
export interface Command {
  /** Command name (derived from filename or frontmatter) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Optional tags for categorization */
  tags?: string[];
  /** Allowed tools for this command (restricts available tools) */
  allowedTools?: string[];
  /** Whether this is a built-in command */
  builtin?: boolean;
  /** The markdown content/instructions */
  content: string;
  /** Source file path (for custom commands) */
  filePath?: string;
  /** Whether the command handles its own execution (doesn't go to LLM) */
  selfHandled?: boolean;
  /** Handler function for self-handled commands */
  handler?: (args: string, context: CommandContext) => Promise<CommandResult>;
}

/**
 * Command frontmatter from markdown files
 */
export interface CommandFrontmatter {
  name?: string;
  description?: string;
  tags?: string[];
  'allowed-tools'?: string;
  [key: string]: unknown;
}

/**
 * Connector info for command context
 */
export interface ConnectorInfo {
  name: string;
  description: string;
  cli: string;
  commands: Array<{ name: string; description: string }>;
}

/**
 * Context passed to command handlers
 */
export interface CommandContext {
  cwd: string;
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  tools: Tool[];
  skills: Array<{ name: string; description: string; argumentHint?: string }>;
  connectors: ConnectorInfo[];
  getErrorStats?: () => ErrorStats[];
  getContextInfo?: () => ContextInfo | null;
  summarizeContext?: () => Promise<ContextProcessResult>;
  getModel?: () => string | undefined;
  getEnergyState?: () => EnergyState | null;
  getVoiceState?: () => VoiceState | null;
  enableVoice?: () => void;
  disableVoice?: () => void;
  speak?: (text: string) => Promise<void>;
  listen?: (options?: RecordOptions) => Promise<string>;
  stopSpeaking?: () => void;
  stopListening?: () => void;
  getAssistantManager?: () => AssistantManager | null;
  getIdentityManager?: () => IdentityManager | null;
  getInboxManager?: () => InboxManager | null;
  getWalletManager?: () => WalletManager | null;
  getSecretsManager?: () => SecretsManager | null;
  getMessagesManager?: () => MessagesManager | null;
  refreshIdentityContext?: () => Promise<void>;
  refreshSkills?: () => Promise<void>;
  switchAssistant?: (assistantId: string) => Promise<void>;
  switchIdentity?: (identityId: string) => Promise<void>;
  getActiveProjectId?: () => string | null;
  setActiveProjectId?: (projectId: string | null) => void;
  setProjectContext?: (content: string | null) => void;
  restEnergy?: (amount?: number) => void;
  clearMessages: () => void;
  addSystemMessage: (content: string) => void;
  emit: (type: 'text' | 'done' | 'error', content?: string) => void;
}

/**
 * Result from command execution
 */
export interface CommandResult {
  /** Whether the command was handled (true = don't send to LLM) */
  handled: boolean;
  /** Optional message to display to user */
  message?: string;
  /** Optional prompt to send to LLM instead */
  prompt?: string;
  /** Whether to clear the conversation */
  clearConversation?: boolean;
  /** Whether to exit the application */
  exit?: boolean;
  /** Session action to perform */
  sessionAction?: 'list' | 'switch' | 'new';
  /** Session number to switch to (1-based) */
  sessionNumber?: number;
  /** Panel to show (terminal-specific interactive UIs) */
  showPanel?: 'connectors' | 'projects' | 'plans' | 'tasks' | 'assistants';
  /** Initial value for panel (e.g., connector name) */
  panelInitialValue?: string;
}

/**
 * Agent-to-Agent Messaging Types
 * Internal messaging system for agent communication
 */

// ============================================
// Message Priority & Status
// ============================================

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';
export type MessageStatus = 'unread' | 'read' | 'archived' | 'injected';

// ============================================
// Core Message Types
// ============================================

/**
 * Full agent message with all content
 */
export interface AgentMessage {
  /** Unique message ID (msg_xxx) */
  id: string;
  /** Thread ID this message belongs to */
  threadId: string;
  /** Parent message ID if this is a reply */
  parentId: string | null;
  /** Sender agent ID */
  fromAgentId: string;
  /** Sender agent name (for display) */
  fromAgentName: string;
  /** Recipient agent ID */
  toAgentId: string;
  /** Recipient agent name (for display) */
  toAgentName: string;
  /** Message subject (optional) */
  subject?: string;
  /** Message body content */
  body: string;
  /** Message priority */
  priority: MessagePriority;
  /** Current status */
  status: MessageStatus;
  /** When message was created (ISO 8601) */
  createdAt: string;
  /** When message was read (ISO 8601) */
  readAt?: string;
  /** When message was injected into context (ISO 8601) */
  injectedAt?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Message list item (summary for listing)
 */
export interface MessageListItem {
  /** Unique message ID */
  id: string;
  /** Thread ID */
  threadId: string;
  /** Parent message ID if reply */
  parentId: string | null;
  /** Sender agent ID */
  fromAgentId: string;
  /** Sender agent name */
  fromAgentName: string;
  /** Message subject */
  subject?: string;
  /** Preview of message body (first ~100 chars) */
  preview: string;
  /** Message priority */
  priority: MessagePriority;
  /** Current status */
  status: MessageStatus;
  /** When created (ISO 8601) */
  createdAt: string;
  /** Number of replies in thread */
  replyCount: number;
}

/**
 * Message thread metadata
 */
export interface MessageThread {
  /** Thread ID */
  threadId: string;
  /** Thread subject (from first message) */
  subject?: string;
  /** Participants in the thread */
  participants: Array<{ agentId: string; agentName: string }>;
  /** Total messages in thread */
  messageCount: number;
  /** Unread messages in thread */
  unreadCount: number;
  /** Last message in thread */
  lastMessage: MessageListItem;
  /** When thread was created (ISO 8601) */
  createdAt: string;
  /** When thread was last updated (ISO 8601) */
  updatedAt: string;
}

// ============================================
// Agent Registry Types
// ============================================

/**
 * Agent registry entry
 */
export interface AgentRegistryEntry {
  /** Agent display name */
  name: string;
  /** When agent was last seen (ISO 8601) */
  lastSeen: string;
}

/**
 * Global agent registry
 */
export interface AgentRegistry {
  /** Map of agentId -> agent info */
  agents: Record<string, AgentRegistryEntry>;
}

// ============================================
// Inbox Index Types
// ============================================

/**
 * Inbox statistics
 */
export interface MessagesInboxStats {
  /** Total messages in inbox */
  totalMessages: number;
  /** Unread message count */
  unreadCount: number;
  /** Number of threads */
  threadCount: number;
}

/**
 * Inbox index for fast lookups
 */
export interface InboxIndex {
  /** List of message summaries */
  messages: MessageListItem[];
  /** Last time inbox was checked */
  lastCheck: string;
  /** Inbox statistics */
  stats: MessagesInboxStats;
}

// ============================================
// Input/Output Types
// ============================================

/**
 * Input for sending a message
 */
export interface SendMessageInput {
  /** Recipient (agent ID or name) */
  to: string;
  /** Message subject (optional) */
  subject?: string;
  /** Message body */
  body: string;
  /** Priority (default: normal) */
  priority?: MessagePriority;
  /** Message ID to reply to */
  replyTo?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result from a messages operation
 */
export interface MessagesOperationResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** Message ID (for send operations) */
  messageId?: string;
  /** Thread ID (for send operations) */
  threadId?: string;
}

// ============================================
// Configuration Types
// ============================================

/**
 * Messages injection configuration
 */
export interface MessagesInjectionConfig {
  /** Whether to auto-inject messages at turn start (default: true) */
  enabled?: boolean;
  /** Max messages to inject per turn (default: 5) */
  maxPerTurn?: number;
  /** Only inject messages >= this priority (default: 'low') */
  minPriority?: MessagePriority;
}

/**
 * Messages storage configuration
 */
export interface MessagesStorageConfig {
  /** Base path for storage (default: ~/.assistants/messages) */
  basePath?: string;
  /** Max messages per inbox (default: 1000) */
  maxMessages?: number;
  /** Max message age in days (default: 90) */
  maxAgeDays?: number;
}

/**
 * Messages system configuration
 */
export interface MessagesConfig {
  /** Whether messages are enabled (default: false) */
  enabled?: boolean;
  /** Auto-injection settings */
  injection?: MessagesInjectionConfig;
  /** Storage settings */
  storage?: MessagesStorageConfig;
}

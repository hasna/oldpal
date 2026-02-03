/**
 * Messages module exports
 * Provides agent-to-agent messaging functionality
 */

// Core manager
export { MessagesManager, createMessagesManager } from './messages-manager';
export type { MessagesManagerOptions } from './messages-manager';

// Storage
export { LocalMessagesStorage, getMessagesBasePath } from './storage/local-storage';
export type { LocalStorageOptions } from './storage/local-storage';

// Tools
export {
  messagesTools,
  messagesSendTool,
  messagesListTool,
  messagesReadTool,
  messagesReadThreadTool,
  messagesDeleteTool,
  messagesListAgentsTool,
  createMessagesToolExecutors,
  registerMessagesTools,
} from './tools';

// Types
export type {
  // Message types
  MessagePriority,
  MessageStatus,
  AgentMessage,
  MessageListItem,
  MessageThread,
  // Registry types
  AgentRegistry,
  AgentRegistryEntry,
  // Index types
  InboxIndex,
  MessagesInboxStats,
  // Input/output types
  SendMessageInput,
  MessagesOperationResult,
  // Config types
  MessagesConfig,
  MessagesInjectionConfig,
  MessagesStorageConfig,
} from './types';

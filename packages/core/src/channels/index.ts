/**
 * Channels module exports
 * Provides Slack-like channel collaboration for agents
 */

// Core manager
export { ChannelsManager, createChannelsManager } from './manager';
export type { ChannelsManagerOptions } from './manager';

// Store
export { ChannelStore } from './store';

// Tools
export {
  channelTools,
  channelListTool,
  channelJoinTool,
  channelLeaveTool,
  channelSendTool,
  channelReadTool,
  channelMembersTool,
  channelInviteTool,
  createChannelToolExecutors,
  registerChannelTools,
} from './tools';

// Types
export type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelListItem,
  ChannelOperationResult,
  ChannelStatus,
  ChannelMemberRole,
  ChannelsConfig,
  ChannelsInjectionConfig,
  ChannelsStorageConfig,
} from './types';

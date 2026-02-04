/**
 * Self-Awareness Tools
 *
 * Tools that allow agents to understand their context, identity, and resources.
 * These enable agents to make informed decisions about expensive operations,
 * adjust behavior based on remaining resources, and identify themselves.
 */

import type { Tool, EnergyState } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import type { ContextManager, ContextInfo, ContextConfig, ContextState } from '../context';
import type { EnergyManager, EnergyEffects, EnergyLevel } from '../energy';
import type { AssistantManager, IdentityManager, Assistant, Identity } from '../identity';
import type { WalletManager } from '../wallet';

// ============================================
// Types
// ============================================

export interface SelfAwarenessContext {
  getContextManager?: () => ContextManager | null;
  getContextInfo?: () => ContextInfo | null;
  getAssistantManager?: () => AssistantManager | null;
  getIdentityManager?: () => IdentityManager | null;
  getEnergyManager?: () => EnergyManager | null;
  getEnergyState?: () => EnergyState | null;
  getWalletManager?: () => WalletManager | null;
  sessionId: string;
  model?: string;
}

// ============================================
// Tool Definitions
// ============================================

export const contextGetTool: Tool = {
  name: 'context_get',
  description:
    'Get current conversation context state including token count, message count, and summarization status. Use this to understand how much context space is used.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const contextStatsTool: Tool = {
  name: 'context_stats',
  description:
    'Get detailed statistics about context management including compression history, limits, and configuration.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const whoamiTool: Tool = {
  name: 'whoami',
  description:
    'Get current agent identity - assistant name, model, session ID, and active identity. Quick way to identify yourself.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const identityGetTool: Tool = {
  name: 'identity_get',
  description:
    'Get full identity information including profile, preferences, and communication style. Returns detailed identity data.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const energyStatusTool: Tool = {
  name: 'energy_status',
  description:
    'Get current energy state, level, and any effects (like response modifications). Check before expensive operations.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const resourceLimitsTool: Tool = {
  name: 'resource_limits',
  description:
    'Get current resource limits including context window, energy thresholds, and wallet rate limits. Use for planning multi-step operations.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

// ============================================
// Tool array for convenience
// ============================================

export const selfAwarenessTools: Tool[] = [
  contextGetTool,
  contextStatsTool,
  whoamiTool,
  identityGetTool,
  energyStatusTool,
  resourceLimitsTool,
];

// ============================================
// Response Types
// ============================================

interface ContextGetResponse {
  totalTokens: number;
  maxContextTokens: number;
  usagePercent: number;
  messageCount: number;
  summaryCount: number;
  lastSummaryAt?: string;
}

interface ContextStatsResponse {
  current: {
    totalTokens: number;
    messageCount: number;
    summaryCount: number;
  };
  limits: {
    maxContextTokens: number;
    targetContextTokens: number;
    summaryTriggerRatio: number;
    maxMessages: number;
  };
  lastSummary?: {
    at: string;
    messageCount: number;
    tokensBefore: number;
    tokensAfter: number;
    strategy: string;
  };
  config: {
    enabled: boolean;
    keepRecentMessages: number;
    summaryStrategy: string;
  };
}

interface WhoamiResponse {
  sessionId: string;
  model?: string;
  assistant?: {
    id: string;
    name: string;
    description?: string;
  };
  identity?: {
    id: string;
    name: string;
    displayName: string;
    communicationStyle: string;
  };
}

interface IdentityGetResponse {
  assistant?: {
    id: string;
    name: string;
    description?: string;
    settings: {
      model: string;
      maxTokens?: number;
      temperature?: number;
      enabledTools?: string[];
      disabledTools?: string[];
    };
    createdAt: string;
    updatedAt: string;
  };
  identity?: {
    id: string;
    name: string;
    isDefault: boolean;
    profile: {
      displayName: string;
      title?: string;
      company?: string;
      timezone: string;
      locale: string;
    };
    preferences: {
      language: string;
      dateFormat: string;
      communicationStyle: string;
      responseLength: string;
    };
    context?: string;
    createdAt: string;
    updatedAt: string;
  };
}

interface EnergyStatusResponse {
  current: number;
  max: number;
  percentage: number;
  level: EnergyLevel;
  regenRate: number;
  effects: {
    promptModifier: string | null;
    responseLengthFactor: number;
    processingDelayMs: number;
  };
}

interface ResourceLimitsResponse {
  context: {
    maxTokens: number;
    targetTokens: number;
    triggerRatio: number;
    maxMessages: number;
    keepRecentMessages: number;
  };
  energy: {
    enabled: boolean;
    maxEnergy: number;
    lowThreshold: number;
    criticalThreshold: number;
    costs: {
      message: number;
      toolCall: number;
      llmCall: number;
      longContext: number;
    };
  };
  wallet: {
    configured: boolean;
    rateLimit?: {
      readsUsed: number;
      maxReads: number;
      windowResetMinutes: number;
    };
  };
}

// ============================================
// Tool Executors Factory
// ============================================

export function createSelfAwarenessToolExecutors(
  context: SelfAwarenessContext
): Record<string, ToolExecutor> {
  return {
    context_get: async (): Promise<string> => {
      const contextInfo = context.getContextInfo?.();

      if (!contextInfo) {
        return JSON.stringify({
          error: 'Context management not available',
          totalTokens: 0,
          maxContextTokens: 0,
          usagePercent: 0,
          messageCount: 0,
          summaryCount: 0,
        });
      }

      const { config, state } = contextInfo;
      const usagePercent = config.maxContextTokens > 0
        ? Math.round((state.totalTokens / config.maxContextTokens) * 10000) / 100
        : 0;

      const response: ContextGetResponse = {
        totalTokens: state.totalTokens,
        maxContextTokens: config.maxContextTokens,
        usagePercent,
        messageCount: state.messageCount,
        summaryCount: state.summaryCount,
        lastSummaryAt: state.lastSummaryAt,
      };

      return JSON.stringify(response, null, 2);
    },

    context_stats: async (): Promise<string> => {
      const contextInfo = context.getContextInfo?.();

      if (!contextInfo) {
        return JSON.stringify({
          error: 'Context management not available',
        });
      }

      const { config, state } = contextInfo;

      const response: ContextStatsResponse = {
        current: {
          totalTokens: state.totalTokens,
          messageCount: state.messageCount,
          summaryCount: state.summaryCount,
        },
        limits: {
          maxContextTokens: config.maxContextTokens,
          targetContextTokens: config.targetContextTokens,
          summaryTriggerRatio: config.summaryTriggerRatio,
          maxMessages: config.maxMessages,
        },
        config: {
          enabled: config.enabled,
          keepRecentMessages: config.keepRecentMessages,
          summaryStrategy: config.summaryStrategy,
        },
      };

      if (state.lastSummaryAt) {
        response.lastSummary = {
          at: state.lastSummaryAt,
          messageCount: state.lastSummaryMessageCount ?? 0,
          tokensBefore: state.lastSummaryTokensBefore ?? 0,
          tokensAfter: state.lastSummaryTokensAfter ?? 0,
          strategy: state.lastSummaryStrategy ?? 'unknown',
        };
      }

      return JSON.stringify(response, null, 2);
    },

    whoami: async (): Promise<string> => {
      const assistantManager = context.getAssistantManager?.();
      const identityManager = context.getIdentityManager?.();

      const assistant = assistantManager?.getActive();
      const identity = identityManager?.getActive();

      const response: WhoamiResponse = {
        sessionId: context.sessionId,
        model: context.model,
      };

      if (assistant) {
        response.assistant = {
          id: assistant.id,
          name: assistant.name,
          description: assistant.description,
        };
      }

      if (identity) {
        response.identity = {
          id: identity.id,
          name: identity.name,
          displayName: identity.profile.displayName,
          communicationStyle: identity.preferences.communicationStyle,
        };
      }

      return JSON.stringify(response, null, 2);
    },

    identity_get: async (): Promise<string> => {
      const assistantManager = context.getAssistantManager?.();
      const identityManager = context.getIdentityManager?.();

      const assistant = assistantManager?.getActive();
      const identity = identityManager?.getActive();

      const response: IdentityGetResponse = {};

      if (assistant) {
        response.assistant = {
          id: assistant.id,
          name: assistant.name,
          description: assistant.description,
          settings: {
            model: assistant.settings.model,
            maxTokens: assistant.settings.maxTokens,
            temperature: assistant.settings.temperature,
            enabledTools: assistant.settings.enabledTools,
            disabledTools: assistant.settings.disabledTools,
          },
          createdAt: assistant.createdAt,
          updatedAt: assistant.updatedAt,
        };
      }

      if (identity) {
        response.identity = {
          id: identity.id,
          name: identity.name,
          isDefault: identity.isDefault,
          profile: {
            displayName: identity.profile.displayName,
            title: identity.profile.title,
            company: identity.profile.company,
            timezone: identity.profile.timezone,
            locale: identity.profile.locale,
          },
          preferences: {
            language: identity.preferences.language,
            dateFormat: identity.preferences.dateFormat,
            communicationStyle: identity.preferences.communicationStyle,
            responseLength: identity.preferences.responseLength,
          },
          context: identity.context,
          createdAt: identity.createdAt,
          updatedAt: identity.updatedAt,
        };
      }

      return JSON.stringify(response, null, 2);
    },

    energy_status: async (): Promise<string> => {
      const energyManager = context.getEnergyManager?.();
      const energyState = context.getEnergyState?.();

      if (!energyManager || !energyState) {
        return JSON.stringify({
          error: 'Energy system not available',
          current: 0,
          max: 0,
          percentage: 0,
          level: 'energetic',
          regenRate: 0,
          effects: {
            promptModifier: null,
            responseLengthFactor: 1.0,
            processingDelayMs: 0,
          },
        });
      }

      const effects = energyManager.getEffects();
      const percentage = energyState.max > 0
        ? Math.round((energyState.current / energyState.max) * 100)
        : 0;

      const response: EnergyStatusResponse = {
        current: energyState.current,
        max: energyState.max,
        percentage,
        level: effects.level,
        regenRate: energyState.regenRate,
        effects: {
          promptModifier: effects.promptModifier ?? null,
          responseLengthFactor: effects.responseLengthFactor,
          processingDelayMs: effects.processingDelayMs,
        },
      };

      return JSON.stringify(response, null, 2);
    },

    resource_limits: async (): Promise<string> => {
      const contextInfo = context.getContextInfo?.();
      const walletManager = context.getWalletManager?.();

      // Default context limits if not available
      const contextConfig = contextInfo?.config ?? {
        maxContextTokens: 200000,
        targetContextTokens: 150000,
        summaryTriggerRatio: 0.85,
        maxMessages: 500,
        keepRecentMessages: 10,
      };

      // Default energy config values
      const defaultEnergyCosts = {
        message: 200,
        toolCall: 500,
        llmCall: 300,
        longContext: 1000,
      };

      const response: ResourceLimitsResponse = {
        context: {
          maxTokens: contextConfig.maxContextTokens,
          targetTokens: contextConfig.targetContextTokens,
          triggerRatio: contextConfig.summaryTriggerRatio,
          maxMessages: contextConfig.maxMessages,
          keepRecentMessages: contextConfig.keepRecentMessages,
        },
        energy: {
          enabled: true,
          maxEnergy: 10000,
          lowThreshold: 3000,
          criticalThreshold: 1000,
          costs: defaultEnergyCosts,
        },
        wallet: {
          configured: walletManager?.isConfigured() ?? false,
        },
      };

      // Add wallet rate limit info if available
      if (walletManager?.isConfigured()) {
        const rateLimitStatus = walletManager.getRateLimitStatus();
        response.wallet.rateLimit = {
          readsUsed: rateLimitStatus.readsUsed,
          maxReads: rateLimitStatus.maxReads,
          windowResetMinutes: rateLimitStatus.windowResetMinutes,
        };
      }

      return JSON.stringify(response, null, 2);
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerSelfAwarenessTools(
  registry: ToolRegistry,
  context: SelfAwarenessContext
): void {
  const executors = createSelfAwarenessToolExecutors(context);

  for (const tool of selfAwarenessTools) {
    registry.register(tool, executors[tool.name]);
  }
}

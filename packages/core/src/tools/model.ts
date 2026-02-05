/**
 * Model Management Tools
 *
 * Tools for listing available models and switching the active model.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { MODELS, getModelById, getModelsByProvider, getModelsGroupedByProvider } from '../llm/models';

// ============================================
// Types
// ============================================

export interface ModelToolsContext {
  getModel: () => string | null;
  switchModel: (modelId: string) => Promise<void>;
}

// ============================================
// Tool Definitions
// ============================================

export const modelListTool: Tool = {
  name: 'model_list',
  description: 'List all available LLM models with their details (provider, context window, cost, capabilities).',
  parameters: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        enum: ['anthropic', 'openai'],
        description: 'Optional: Filter to only show models from a specific provider',
      },
    },
    required: [],
  },
};

export const modelGetTool: Tool = {
  name: 'model_get',
  description: 'Get detailed information about a specific model by ID.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The model ID to retrieve details for',
      },
    },
    required: ['id'],
  },
};

export const modelCurrentTool: Tool = {
  name: 'model_current',
  description: 'Get information about the currently active model.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const modelSwitchTool: Tool = {
  name: 'model_switch',
  description: 'Switch to a different LLM model. Changes take effect immediately for subsequent requests.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The model ID to switch to (e.g., "claude-opus-4-5-20251101", "gpt-5.2")',
      },
    },
    required: ['id'],
  },
};

export const modelTools: Tool[] = [
  modelListTool,
  modelGetTool,
  modelCurrentTool,
  modelSwitchTool,
];

// ============================================
// Tool Executors Factory
// ============================================

export function createModelToolExecutors(
  context: ModelToolsContext
): Record<string, ToolExecutor> {
  return {
    model_list: async (input: Record<string, unknown>): Promise<string> => {
      const providerFilter = input.provider as 'anthropic' | 'openai' | undefined;

      let models;
      if (providerFilter) {
        models = getModelsByProvider(providerFilter);
      } else {
        models = MODELS;
      }

      const currentModel = context.getModel();
      const grouped = getModelsGroupedByProvider();

      const list = models.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        description: m.description,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        inputCostPer1M: m.inputCostPer1M,
        outputCostPer1M: m.outputCostPer1M,
        supportsTools: m.supportsTools ?? true,
        supportsStreaming: m.supportsStreaming ?? true,
        isCurrent: m.id === currentModel,
        notes: m.notes || null,
      }));

      return JSON.stringify({
        success: true,
        currentModel,
        total: list.length,
        providers: {
          anthropic: grouped.anthropic.length,
          openai: grouped.openai.length,
        },
        models: list,
      });
    },

    model_get: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Model ID is required',
        });
      }

      const model = getModelById(id);
      if (!model) {
        return JSON.stringify({
          success: false,
          error: `Model "${id}" not found. Use model_list to see available models.`,
        });
      }

      const currentModel = context.getModel();

      return JSON.stringify({
        success: true,
        model: {
          id: model.id,
          name: model.name,
          provider: model.provider,
          description: model.description,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          inputCostPer1M: model.inputCostPer1M,
          outputCostPer1M: model.outputCostPer1M,
          supportsTools: model.supportsTools ?? true,
          supportsStreaming: model.supportsStreaming ?? true,
          notes: model.notes || null,
          isCurrent: model.id === currentModel,
        },
      });
    },

    model_current: async (): Promise<string> => {
      const currentModelId = context.getModel();
      if (!currentModelId) {
        return JSON.stringify({
          success: false,
          error: 'No model currently active',
        });
      }

      const model = getModelById(currentModelId);
      if (!model) {
        return JSON.stringify({
          success: true,
          modelId: currentModelId,
          name: currentModelId,
          note: 'Model details not found in registry',
        });
      }

      return JSON.stringify({
        success: true,
        model: {
          id: model.id,
          name: model.name,
          provider: model.provider,
          description: model.description,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          inputCostPer1M: model.inputCostPer1M,
          outputCostPer1M: model.outputCostPer1M,
        },
      });
    },

    model_switch: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Model ID is required',
        });
      }

      const model = getModelById(id);
      if (!model) {
        return JSON.stringify({
          success: false,
          error: `Model "${id}" not found. Use model_list to see available models.`,
        });
      }

      const previousModel = context.getModel();

      try {
        await context.switchModel(id);

        return JSON.stringify({
          success: true,
          message: `Switched from "${previousModel}" to "${model.name}"`,
          previousModel,
          newModel: {
            id: model.id,
            name: model.name,
            provider: model.provider,
            contextWindow: model.contextWindow,
          },
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to switch model',
        });
      }
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerModelTools(
  registry: ToolRegistry,
  context: ModelToolsContext
): void {
  const executors = createModelToolExecutors(context);

  for (const tool of modelTools) {
    registry.register(tool, executors[tool.name]);
  }
}

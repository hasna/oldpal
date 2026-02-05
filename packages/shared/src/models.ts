// Model definitions for consistent model selection across terminal and web

export type ModelProvider = 'anthropic' | 'openai';

export interface ModelDefinition {
  id: string;
  provider: ModelProvider;
  name: string;
  description: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

/**
 * All available models across all providers
 */
export const ALL_MODELS: ModelDefinition[] = [
  // Anthropic Claude Models
  {
    id: 'claude-opus-4-5-20251101',
    provider: 'anthropic',
    name: 'Claude Opus 4.5',
    description: 'Most capable, best for complex tasks',
    contextWindow: 200000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    name: 'Claude Sonnet 4',
    description: 'Balanced performance and speed',
    contextWindow: 200000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    name: 'Claude 3.5 Sonnet',
    description: 'Fast and capable',
    contextWindow: 200000,
    maxOutputTokens: 8192,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    name: 'Claude 3.5 Haiku',
    description: 'Fastest, best for simple tasks',
    contextWindow: 200000,
    maxOutputTokens: 8192,
  },
  // OpenAI GPT Models
  {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    description: 'Fast multimodal flagship',
    contextWindow: 128000,
    maxOutputTokens: 16384,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    name: 'GPT-4o Mini',
    description: 'Affordable small model',
    contextWindow: 128000,
    maxOutputTokens: 16384,
  },
  {
    id: 'o1',
    provider: 'openai',
    name: 'o1',
    description: 'Reasoning model for complex tasks',
    contextWindow: 200000,
    maxOutputTokens: 100000,
  },
  {
    id: 'o1-mini',
    provider: 'openai',
    name: 'o1 Mini',
    description: 'Fast reasoning model',
    contextWindow: 128000,
    maxOutputTokens: 65536,
  },
] as const;

/**
 * @deprecated Use ALL_MODELS instead. Only includes Anthropic models for backward compatibility.
 */
export const ANTHROPIC_MODELS: ModelDefinition[] = ALL_MODELS.filter(m => m.provider === 'anthropic');

export const DEFAULT_MODEL = 'claude-opus-4-5-20251101';

export const DEFAULT_TEMPERATURE = 1.0;
export const MIN_TEMPERATURE = 0.0;
export const MAX_TEMPERATURE = 2.0;
export const TEMPERATURE_STEP = 0.1;

export const DEFAULT_MAX_TOKENS = 8192;

/**
 * Get a model definition by ID
 */
export function getModelById(modelId: string): ModelDefinition | undefined {
  return ALL_MODELS.find((m) => m.id === modelId);
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProvider(provider: ModelProvider): ModelDefinition[] {
  return ALL_MODELS.filter((m) => m.provider === provider);
}

/**
 * Get the provider for a model ID
 */
export function getProviderForModel(modelId: string): ModelProvider | undefined {
  return getModelById(modelId)?.provider;
}

/**
 * Get model display name by ID
 */
export function getModelDisplayName(modelId: string): string {
  const model = getModelById(modelId);
  return model?.name ?? modelId;
}

/**
 * Clamp maxTokens to the model's maximum output tokens
 */
export function clampMaxTokens(modelId: string, maxTokens: number): number {
  const model = getModelById(modelId);
  const modelMax = model?.maxOutputTokens ?? 8192;
  return Math.min(maxTokens, modelMax);
}

/**
 * Get models grouped by provider for UI display
 */
export function getModelsGroupedByProvider(): Record<ModelProvider, ModelDefinition[]> {
  return {
    anthropic: getModelsByProvider('anthropic'),
    openai: getModelsByProvider('openai'),
  };
}

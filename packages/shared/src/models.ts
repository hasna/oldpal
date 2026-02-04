// Anthropic model definitions for consistent model selection across terminal and web

export interface ModelDefinition {
  id: string;
  name: string;
  description: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export const ANTHROPIC_MODELS: ModelDefinition[] = [
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    description: 'Most capable, best for complex tasks',
    contextWindow: 200000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    description: 'Balanced performance and speed',
    contextWindow: 200000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    description: 'Fast and capable',
    contextWindow: 200000,
    maxOutputTokens: 8192,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    description: 'Fastest, best for simple tasks',
    contextWindow: 200000,
    maxOutputTokens: 8192,
  },
] as const;

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
  return ANTHROPIC_MODELS.find((m) => m.id === modelId);
}

/**
 * Get model display name by ID
 */
export function getModelDisplayName(modelId: string): string {
  const model = getModelById(modelId);
  return model?.name ?? modelId;
}

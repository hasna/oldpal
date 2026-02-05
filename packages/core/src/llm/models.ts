/**
 * Model Registry - Centralized model definitions for all providers
 */

export interface ModelDefinition {
  id: string;
  provider: 'anthropic' | 'openai';
  name: string;
  description: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  /** Whether this model supports tool/function calling */
  supportsTools?: boolean;
  /** Whether this model supports streaming */
  supportsStreaming?: boolean;
  /** Special capabilities or notes */
  notes?: string;
}

/**
 * All available models across providers
 */
export const MODELS: ModelDefinition[] = [
  // ============================================
  // Anthropic Claude Models
  // ============================================
  {
    id: 'claude-opus-4-5-20251101',
    provider: 'anthropic',
    name: 'Claude Opus 4.5',
    description: 'Most intelligent, best for complex tasks',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPer1M: 15,
    outputCostPer1M: 75,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    name: 'Claude Sonnet 4',
    description: 'Fast and capable, great balance',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    name: 'Claude 3.5 Haiku',
    description: 'Fastest, cost-effective',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPer1M: 1,
    outputCostPer1M: 5,
    supportsTools: true,
    supportsStreaming: true,
  },

  // ============================================
  // OpenAI GPT-5.2 Models
  // ============================================
  {
    id: 'gpt-5.2',
    provider: 'openai',
    name: 'GPT-5.2 Thinking',
    description: 'Main flagship model, complex tasks',
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputCostPer1M: 1.75,
    outputCostPer1M: 14,
    supportsTools: true,
    supportsStreaming: true,
    notes: 'Best for professional use and complex reasoning',
  },
  {
    id: 'gpt-5.2-chat-latest',
    provider: 'openai',
    name: 'GPT-5.2 Instant',
    description: 'Fast everyday workhorse',
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputCostPer1M: 1.75,
    outputCostPer1M: 14,
    supportsTools: true,
    supportsStreaming: true,
    notes: 'Optimized for quick responses',
  },
  {
    id: 'gpt-5.2-pro',
    provider: 'openai',
    name: 'GPT-5.2 Pro',
    description: 'High-stakes, extended reasoning',
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputCostPer1M: 21,
    outputCostPer1M: 84,
    supportsTools: true,
    supportsStreaming: true,
    notes: 'Supports xhigh reasoning effort',
  },
  {
    id: 'gpt-5.2-codex',
    provider: 'openai',
    name: 'GPT-5.2 Codex',
    description: 'Specialized for coding',
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputCostPer1M: 1.75,
    outputCostPer1M: 14,
    supportsTools: true,
    supportsStreaming: true,
    notes: 'Optimized for agentic coding tasks',
  },
];

/**
 * Get a model definition by ID
 */
export function getModelById(id: string): ModelDefinition | undefined {
  return MODELS.find((m) => m.id === id);
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProvider(provider: 'anthropic' | 'openai'): ModelDefinition[] {
  return MODELS.filter((m) => m.provider === provider);
}

/**
 * Get the provider for a model ID
 */
export function getProviderForModel(modelId: string): 'anthropic' | 'openai' | undefined {
  const model = getModelById(modelId);
  return model?.provider;
}

/**
 * Check if a model ID is valid
 */
export function isValidModel(modelId: string): boolean {
  return MODELS.some((m) => m.id === modelId);
}

/**
 * Get all available model IDs
 */
export function getAllModelIds(): string[] {
  return MODELS.map((m) => m.id);
}

/**
 * Get a short display name for a model
 */
export function getModelDisplayName(modelId: string): string {
  const model = getModelById(modelId);
  return model?.name ?? modelId;
}

/**
 * Format model info for display
 */
export function formatModelInfo(model: ModelDefinition): string {
  const lines = [
    `**${model.name}** (${model.id})`,
    `Provider: ${model.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}`,
    `${model.description}`,
    `Context: ${(model.contextWindow / 1000).toFixed(0)}K tokens`,
    `Max output: ${(model.maxOutputTokens / 1000).toFixed(0)}K tokens`,
    `Cost: $${model.inputCostPer1M}/1M in, $${model.outputCostPer1M}/1M out`,
  ];
  if (model.notes) {
    lines.push(`Note: ${model.notes}`);
  }
  return lines.join('\n');
}

/**
 * Group models by provider for display
 */
export function getModelsGroupedByProvider(): Record<string, ModelDefinition[]> {
  return {
    anthropic: getModelsByProvider('anthropic'),
    openai: getModelsByProvider('openai'),
  };
}

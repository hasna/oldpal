import type { Message, Tool, StreamChunk, LLMConfig } from '@hasna/assistants-shared';

/**
 * Abstract LLM client interface
 */
export interface LLMClient {
  /**
   * Send messages and get a streaming response
   */
  chat(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string
  ): AsyncGenerator<StreamChunk>;

  /**
   * Get the model name
   */
  getModel(): string;
}

/**
 * Create an LLM client based on config
 */
export async function createLLMClient(config: LLMConfig): Promise<LLMClient> {
  if (config.provider === 'anthropic') {
    const { AnthropicClient } = await import('./anthropic');
    return new AnthropicClient(config);
  }

  throw new Error(`Unsupported LLM provider: ${config.provider}`);
}

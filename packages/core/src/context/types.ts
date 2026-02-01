import type { Message } from '@hasna/assistants-shared';

export interface ContextConfig {
  enabled: boolean;
  maxContextTokens: number;
  targetContextTokens: number;
  summaryTriggerRatio: number;
  keepRecentMessages: number;
  keepSystemPrompt: boolean;
  summaryStrategy: 'llm' | 'hybrid';
  summaryModel?: string;
  summaryMaxTokens: number;
  maxMessages: number;
}

export interface ContextState {
  totalTokens: number;
  messageCount: number;
  summaryCount: number;
  lastSummaryAt?: string;
  lastSummaryMessageCount?: number;
  lastSummaryTokensBefore?: number;
  lastSummaryTokensAfter?: number;
  lastSummaryStrategy?: string;
}

export interface ContextProcessResult {
  messages: Message[];
  summarized: boolean;
  summary?: string;
  tokensBefore: number;
  tokensAfter: number;
  summarizedCount: number;
}

export interface ContextInfo {
  config: ContextConfig;
  state: ContextState;
}

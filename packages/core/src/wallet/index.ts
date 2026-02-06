/**
 * Wallet module exports
 * Provides secure payment card storage for assistants using AWS Secrets Manager
 *
 * SECURITY NOTE: Cards are NEVER stored locally. All card data is stored
 * exclusively in AWS Secrets Manager and fetched on-demand with rate limiting.
 */

// Core manager
export { WalletManager, createWalletManager } from './wallet-manager';
export type { WalletManagerOptions } from './wallet-manager';

// Storage (AWS Secrets Manager)
export { SecretsClient } from './storage/secrets-client';
export type { SecretsClientOptions } from './storage/secrets-client';

// Tools
export {
  walletTools,
  walletListTool,
  walletAddTool,
  walletGetTool,
  walletRemoveTool,
  createWalletToolExecutors,
  registerWalletTools,
} from './tools';

// Types
export type {
  Card,
  CardListItem,
  CardForAutomation,
  CardForPayment,
  AddCardInput,
  BillingAddress,
  RateLimitState,
  WalletOperationResult,
} from './types';

/**
 * Secrets module exports
 * Provides secure secrets storage for agents using AWS Secrets Manager
 *
 * SECURITY NOTE: Secrets are NEVER stored locally. All secret data is stored
 * exclusively in AWS Secrets Manager and fetched on-demand with rate limiting.
 */

// Core manager
export { SecretsManager, createSecretsManager, isValidSecretName } from './secrets-manager';
export type { SecretsManagerOptions } from './secrets-manager';

// Storage (AWS Secrets Manager)
export { SecretsStorageClient } from './secrets-client';
export type { SecretsStorageClientOptions } from './secrets-client';

// Tools
export {
  secretsTools,
  secretsListTool,
  secretsGetTool,
  secretsSetTool,
  secretsDeleteTool,
  createSecretsToolExecutors,
  registerSecretsTools,
} from './tools';

// Types
export type {
  Secret,
  SecretListItem,
  SecretScope,
  SecretFormat,
  SecretsRateLimitState,
  SecretsOperationResult,
  SetSecretInput,
} from './types';

/**
 * Agent Registry Module
 *
 * Provides agent registration, discovery, and lifecycle management.
 */

export * from './types';
export { RegistryStore } from './store';
export { AgentRegistryService, getGlobalRegistry, resetGlobalRegistry } from './service';

import type { HookConfig, HookMatcher, HookEvent } from '@oldpal/shared';

/**
 * Hook loader - manages hook configuration
 */
export class HookLoader {
  private hooks: HookConfig = {};

  /**
   * Load hooks from configuration
   */
  load(config: HookConfig): void {
    this.hooks = config;
  }

  /**
   * Merge additional hooks
   */
  merge(config: HookConfig): void {
    for (const [event, matchers] of Object.entries(config)) {
      if (!this.hooks[event]) {
        this.hooks[event] = [];
      }
      this.hooks[event].push(...matchers);
    }
  }

  /**
   * Get hooks for a specific event
   */
  getHooks(event: HookEvent): HookMatcher[] {
    return this.hooks[event] || [];
  }

  /**
   * Get all hooks
   */
  getAllHooks(): HookConfig {
    return { ...this.hooks };
  }

  /**
   * Check if there are hooks for an event
   */
  hasHooks(event: HookEvent): boolean {
    const hooks = this.hooks[event];
    return hooks !== undefined && hooks.length > 0;
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks = {};
  }
}

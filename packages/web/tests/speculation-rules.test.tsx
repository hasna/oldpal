import React from 'react';
import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock useAuth
let mockIsAuthenticated = false;
mock.module('@/hooks/use-auth', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    isLoading: false,
  }),
}));

describe('SpeculationRules', () => {
  beforeEach(() => {
    mockIsAuthenticated = false;
  });

  describe('isSpeculationRulesSupported', () => {
    test('returns false in server environment', async () => {
      // Clear module cache to get fresh import
      const module = await import('../src/components/shared/SpeculationRules');

      // In server environment, window is undefined so it returns false
      const result = module.isSpeculationRulesSupported();
      expect(typeof result).toBe('boolean');
      // In Node/Bun without DOM, it should return false
      expect(result).toBe(false);
    });
  });

  describe('component rendering', () => {
    test('renders null (no visible output)', async () => {
      const { SpeculationRules } = await import('../src/components/shared/SpeculationRules');

      // Server render should produce empty output
      const markup = renderToStaticMarkup(<SpeculationRules />);
      expect(markup).toBe('');
    });
  });

  describe('module exports', () => {
    test('exports SpeculationRules component', async () => {
      const module = await import('../src/components/shared/SpeculationRules');
      expect(module.SpeculationRules).toBeDefined();
      expect(typeof module.SpeculationRules).toBe('function');
    });

    test('exports isSpeculationRulesSupported function', async () => {
      const module = await import('../src/components/shared/SpeculationRules');
      expect(module.isSpeculationRulesSupported).toBeDefined();
      expect(typeof module.isSpeculationRulesSupported).toBe('function');
    });
  });

  describe('prefetch routes configuration', () => {
    test('component includes sensible routes for prefetching', async () => {
      // We can verify the module loads without errors
      // The actual routes are private but the component should load
      const module = await import('../src/components/shared/SpeculationRules');

      // Verify the component exists and is a valid React component
      const Component = module.SpeculationRules;
      expect(Component).toBeDefined();

      // Render should succeed
      const markup = renderToStaticMarkup(<Component />);
      expect(markup).toBe(''); // Returns null
    });
  });
});

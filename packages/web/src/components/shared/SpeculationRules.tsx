'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';

/**
 * Dashboard routes to prefetch when user is authenticated.
 * These are the most commonly navigated routes from the dashboard.
 */
const PREFETCH_ROUTES = [
  '/chat',
  '/sessions',
  '/agents',
  '/messages',
  '/settings',
];

/**
 * SpeculationRules component
 *
 * Emits Speculation Rules for prefetching likely next dashboard routes
 * when the user is authenticated. Uses conservative prefetch (no prerender)
 * to avoid unnecessary server load.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API
 */
export function SpeculationRules() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    // Only add rules when authenticated and feature is enabled
    if (!isAuthenticated) return;

    // Check if Speculation Rules API is supported
    if (!HTMLScriptElement.supports?.('speculationrules')) {
      return;
    }

    // Check if feature is enabled via environment variable
    const isEnabled = process.env.NEXT_PUBLIC_SPECULATION_RULES_ENABLED === 'true';
    if (!isEnabled) {
      return;
    }

    // Create speculation rules script
    const rules = {
      prefetch: [
        {
          source: 'list',
          urls: PREFETCH_ROUTES,
          eagerness: 'moderate', // prefetch on hover/focus
        },
      ],
    };

    const script = document.createElement('script');
    script.type = 'speculationrules';
    script.textContent = JSON.stringify(rules);
    script.id = 'speculation-rules-prefetch';

    // Remove existing rules if any
    const existing = document.getElementById('speculation-rules-prefetch');
    if (existing) {
      existing.remove();
    }

    document.head.appendChild(script);

    return () => {
      const el = document.getElementById('speculation-rules-prefetch');
      if (el) {
        el.remove();
      }
    };
  }, [isAuthenticated]);

  return null;
}

/**
 * Check if Speculation Rules API is supported in the current browser.
 */
export function isSpeculationRulesSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return HTMLScriptElement.supports?.('speculationrules') ?? false;
}

'use client';

import { useReportWebVitals } from 'next/web-vitals';

/**
 * Web Vitals reporter component.
 *
 * Captures Core Web Vitals (LCP, CLS, INP) and other metrics (FCP, TTFB).
 * Only enabled in production mode via NEXT_PUBLIC_WEB_VITALS=true.
 *
 * Metrics are logged to console and can optionally be sent to an analytics endpoint.
 */
export function WebVitals() {
  useReportWebVitals((metric) => {
    // Only report in production when explicitly enabled
    const enabled = process.env.NEXT_PUBLIC_WEB_VITALS === 'true';
    if (process.env.NODE_ENV !== 'production' || !enabled) {
      return;
    }

    // Core Web Vitals thresholds (good/needs improvement/poor)
    const thresholds: Record<string, { good: number; poor: number }> = {
      LCP: { good: 2500, poor: 4000 }, // Largest Contentful Paint (ms)
      CLS: { good: 0.1, poor: 0.25 }, // Cumulative Layout Shift
      INP: { good: 200, poor: 500 }, // Interaction to Next Paint (ms)
      FCP: { good: 1800, poor: 3000 }, // First Contentful Paint (ms)
      TTFB: { good: 800, poor: 1800 }, // Time to First Byte (ms)
    };

    const threshold = thresholds[metric.name];
    let rating: 'good' | 'needs-improvement' | 'poor' = 'good';

    if (threshold) {
      if (metric.value > threshold.poor) {
        rating = 'poor';
      } else if (metric.value > threshold.good) {
        rating = 'needs-improvement';
      }
    }

    // Log to console for debugging (can be disabled in production)
    console.debug('[WebVitals]', {
      name: metric.name,
      value: metric.value.toFixed(2),
      rating,
      id: metric.id,
      navigationType: metric.navigationType,
    });

    // Optionally send to analytics endpoint
    const analyticsEndpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
    if (analyticsEndpoint) {
      // Use sendBeacon for reliability during page unload
      const body = JSON.stringify({
        name: metric.name,
        value: metric.value,
        rating,
        id: metric.id,
        navigationType: metric.navigationType,
        timestamp: Date.now(),
        path: window.location.pathname,
      });

      if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(analyticsEndpoint, body);
      } else {
        fetch(analyticsEndpoint, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
        }).catch(() => {
          // Ignore errors - analytics is best-effort
        });
      }
    }
  });

  // This component doesn't render anything
  return null;
}

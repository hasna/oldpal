"use client";

import { useEffect } from 'react';

export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Ignore registration errors to avoid blocking app load.
    });
  }, []);

  return null;
}

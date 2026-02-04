'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export function UpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    // Check for updates to the service worker
    const checkForUpdates = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        setRegistration(reg);

        // Listen for new service worker installation
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available
              setUpdateAvailable(true);
            }
          });
        });

        // Check if there's already a waiting worker
        if (reg.waiting && navigator.serviceWorker.controller) {
          setUpdateAvailable(true);
        }

        // Also check periodically for updates
        const intervalId = setInterval(() => {
          reg.update().catch(() => {
            // Ignore update check errors
          });
        }, 60 * 60 * 1000); // Check every hour

        return () => clearInterval(intervalId);
      } catch {
        // Ignore service worker errors
      }
    };

    checkForUpdates();
  }, []);

  const handleUpdate = () => {
    if (!registration?.waiting) return;

    // Tell the waiting service worker to skip waiting
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });

    // Reload the page to use the new version
    window.location.reload();
  };

  const handleDismiss = () => {
    setUpdateAvailable(false);
  };

  if (!updateAvailable) return null;

  return (
    <div
      className={cn(
        'fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50',
        'bg-primary text-primary-foreground rounded-lg shadow-lg p-4',
        'animate-in slide-in-from-bottom-5 fade-in duration-300'
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 p-2 rounded-full bg-white/10">
          <RefreshCw className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm">Update available</h3>
          <p className="text-xs opacity-90 mt-1">
            A new version of Assistants is available. Refresh to update.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleUpdate}
              className="bg-white/20 hover:bg-white/30 text-white"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Refresh now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="text-white hover:bg-white/10"
            >
              Later
            </Button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 rounded hover:bg-white/10"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

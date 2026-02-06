'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, X, ArrowUpCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { UsageStatus, UsageOverview } from '@/lib/usage';

interface UsageWarningBannerProps {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  className?: string;
}

// Storage key for dismissed warnings
const DISMISSED_WARNINGS_KEY = 'usage-warnings-dismissed';
const DISMISS_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function getTypeLabel(type: UsageStatus['type']): string {
  switch (type) {
    case 'assistants': return 'assistants';
    case 'messages': return 'messages today';
    case 'sessions': return 'sessions';
    case 'schedules': return 'schedules';
    default: return type;
  }
}

function getDismissedWarnings(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const stored = localStorage.getItem(DISMISSED_WARNINGS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function setDismissedWarning(type: string): void {
  if (typeof localStorage === 'undefined') return;
  const dismissed = getDismissedWarnings();
  dismissed[type] = Date.now();
  localStorage.setItem(DISMISSED_WARNINGS_KEY, JSON.stringify(dismissed));
}

function isWarningDismissed(type: string): boolean {
  const dismissed = getDismissedWarnings();
  const dismissedAt = dismissed[type];
  if (!dismissedAt) return false;
  return Date.now() - dismissedAt < DISMISS_DURATION;
}

export function UsageWarningBanner({ fetchWithAuth, className }: UsageWarningBannerProps) {
  const router = useRouter();
  const [overview, setOverview] = useState<UsageOverview | null>(null);
  const [dismissedTypes, setDismissedTypes] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  const loadUsage = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/v1/usage');
      const data = await response.json();

      if (data.success) {
        setOverview(data.data.usage);
      }
    } catch {
      // Silently fail - this is a non-critical feature
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    loadUsage();

    // Also set initially dismissed types from localStorage
    const dismissed = getDismissedWarnings();
    const validDismissed = new Set<string>();
    for (const [type, timestamp] of Object.entries(dismissed)) {
      if (Date.now() - timestamp < DISMISS_DURATION) {
        validDismissed.add(type);
      }
    }
    setDismissedTypes(validDismissed);
  }, [loadUsage]);

  const handleDismiss = (type: string) => {
    setDismissedWarning(type);
    setDismissedTypes(prev => new Set([...prev, type]));
  };

  const handleUpgrade = () => {
    router.push('/billing');
  };

  if (isLoading || !overview) return null;

  // Filter to only show warnings that aren't dismissed
  const activeWarnings = overview.warnings.filter(w => !dismissedTypes.has(w.type));

  if (activeWarnings.length === 0) return null;

  // Get the most critical warning to display
  const sortedWarnings = [...activeWarnings].sort((a, b) => {
    const priority = { exceeded: 4, critical: 3, warning: 2, ok: 1 };
    return priority[b.status] - priority[a.status];
  });

  const primaryWarning = sortedWarnings[0];
  const otherWarningsCount = sortedWarnings.length - 1;

  const isExceeded = primaryWarning.status === 'exceeded';
  const isCritical = primaryWarning.status === 'critical';

  return (
    <div
      className={cn(
        'relative flex items-center gap-3 px-4 py-3 text-sm rounded-lg',
        isExceeded && 'bg-destructive/10 border border-destructive/30 text-destructive',
        isCritical && !isExceeded && 'bg-orange-500/10 border border-orange-500/30 text-orange-700 dark:text-orange-400',
        !isExceeded && !isCritical && 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-400',
        className
      )}
      role="alert"
    >
      {isExceeded ? (
        <AlertTriangle className="h-5 w-5 flex-shrink-0" />
      ) : isCritical ? (
        <AlertTriangle className="h-5 w-5 flex-shrink-0" />
      ) : (
        <Info className="h-5 w-5 flex-shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <p className="font-medium">
          {isExceeded ? (
            <>Limit reached: {primaryWarning.limit} {getTypeLabel(primaryWarning.type)}</>
          ) : (
            <>
              {Math.round(primaryWarning.percentage)}% of {getTypeLabel(primaryWarning.type)} used
              {' '}({primaryWarning.current}/{primaryWarning.limit})
            </>
          )}
        </p>
        {otherWarningsCount > 0 && (
          <p className="text-xs opacity-80 mt-0.5">
            +{otherWarningsCount} other {otherWarningsCount === 1 ? 'limit' : 'limits'} approaching
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={handleUpgrade}
          className={cn(
            'h-8 px-3',
            isExceeded && 'border-destructive/50 hover:bg-destructive/10',
            isCritical && !isExceeded && 'border-orange-500/50 hover:bg-orange-500/10',
            !isExceeded && !isCritical && 'border-yellow-500/50 hover:bg-yellow-500/10'
          )}
        >
          <ArrowUpCircle className="h-4 w-4 mr-1.5" />
          Upgrade
        </Button>

        {!isExceeded && (
          <button
            onClick={() => handleDismiss(primaryWarning.type)}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5"
            aria-label="Dismiss warning"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

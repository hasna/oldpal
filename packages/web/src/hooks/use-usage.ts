'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './use-auth';

export interface UsageStatus {
  type: 'agents' | 'messages' | 'sessions' | 'schedules';
  current: number;
  limit: number;
  percentage: number;
  status: 'ok' | 'warning' | 'critical' | 'exceeded';
}

export interface UsageOverview {
  limits: {
    maxAgents: number;
    maxMessagesPerDay: number;
    maxSessions: number;
    maxSchedules: number;
  };
  current: {
    agents: number;
    messagesThisPeriod: number;
    sessions: number;
    schedules: number;
  };
  statuses: UsageStatus[];
  warnings: UsageStatus[];
  planName: string;
  isFreeTier: boolean;
}

interface UseUsageResult {
  usage: UsageOverview | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  canCreateAgent: boolean;
  canCreateSession: boolean;
  canCreateSchedule: boolean;
  canSendMessage: boolean;
}

export function useUsage(): UseUsageResult {
  const { fetchWithAuth, isAuthenticated } = useAuth();
  const [usage, setUsage] = useState<UsageOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setIsLoading(true);
      const response = await fetchWithAuth('/api/v1/usage');
      const data = await response.json();

      if (data.success) {
        setUsage(data.data.usage);
        setError(null);
      } else {
        setError(data.error?.message || 'Failed to load usage');
      }
    } catch (err) {
      setError('Failed to load usage');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, isAuthenticated]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Calculate can* flags based on usage
  const canCreateAgent = usage
    ? usage.limits.maxAgents === -1 || usage.current.agents < usage.limits.maxAgents
    : true;

  const canCreateSession = usage
    ? usage.limits.maxSessions === -1 || usage.current.sessions < usage.limits.maxSessions
    : true;

  const canCreateSchedule = usage
    ? usage.limits.maxSchedules === -1 || usage.current.schedules < usage.limits.maxSchedules
    : true;

  const canSendMessage = usage
    ? usage.limits.maxMessagesPerDay === -1 || usage.current.messagesThisPeriod < usage.limits.maxMessagesPerDay
    : true;

  return {
    usage,
    isLoading,
    error,
    refetch: fetchUsage,
    canCreateAgent,
    canCreateSession,
    canCreateSchedule,
    canSendMessage,
  };
}

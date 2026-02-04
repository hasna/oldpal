'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Activity,
  Database,
  RefreshCw,
  Users,
  MessageSquare,
  Bot,
  Clock,
} from 'lucide-react';

interface Stats {
  totals: {
    users: number;
    sessions: number;
    agents: number;
    messages: number;
    agentMessages: number;
  };
  recent: {
    newUsersToday: number;
    newUsersWeek: number;
    newUsersMonth: number;
    sessionsToday: number;
    messagesWeek: number;
  };
  generated: string;
}

interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: {
    status: 'connected' | 'error';
    latencyMs: number;
    error: string | null;
  };
  activity: {
    activeSessionsLastHour: number;
    activeUsersLastHour: number;
  };
  timestamp: string;
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: number;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="p-4 rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <p className="text-sm text-gray-500">{title}</p>
      </div>
      <p className="text-3xl font-semibold text-gray-900 mt-1">{value.toLocaleString()}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
}

function HealthCard({
  title,
  status,
  value,
  icon: Icon,
}: {
  title: string;
  status: 'healthy' | 'warning' | 'error';
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const statusColors = {
    healthy: 'bg-green-100 text-green-800 border-green-200',
    warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    error: 'bg-red-100 text-red-800 border-red-200',
  };

  const badgeVariants: Record<string, 'success' | 'default' | 'error'> = {
    healthy: 'success',
    warning: 'default',
    error: 'error',
  };

  return (
    <div className={`p-4 rounded-lg border ${statusColors[status]}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5" />
          <span className="font-medium">{title}</span>
        </div>
        <Badge variant={badgeVariants[status]}>
          {status === 'healthy' ? 'OK' : status === 'warning' ? 'Warning' : 'Error'}
        </Badge>
      </div>
      <p className="text-lg font-semibold mt-2">{value}</p>
    </div>
  );
}

export default function AdminStatsPage() {
  const router = useRouter();
  const { user, fetchWithAuth } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user && user.role !== 'admin') {
      router.push('/chat');
    }
  }, [user, router]);

  const loadStats = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/v1/admin/stats');
      const data = await response.json();
      if (data.success) {
        setStats(data.data);
      } else {
        setError(data.error?.message || 'Failed to load stats');
      }
    } catch {
      setError('Failed to load stats');
    }
  }, [fetchWithAuth]);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/v1/admin/system');
      const data = await response.json();
      if (data.success) {
        setHealth(data.data);
      }
    } catch {
      // Health check failed - show as unhealthy
      setHealth({
        status: 'unhealthy',
        database: { status: 'error', latencyMs: 0, error: 'Connection failed' },
        activity: { activeSessionsLastHour: 0, activeUsersLastHour: 0 },
        timestamp: new Date().toISOString(),
      });
    }
  }, [fetchWithAuth]);

  const loadAll = useCallback(async () => {
    setError('');
    await Promise.all([loadStats(), loadHealth()]);
    setIsLoading(false);
    setIsRefreshing(false);
  }, [loadStats, loadHealth]);

  useEffect(() => {
    if (user?.role === 'admin') {
      loadAll();
    }
  }, [loadAll, user?.role]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadAll();
  };

  if (user?.role !== 'admin') {
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <Button variant="ghost" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* System Health */}
        {health && (
          <section className="mb-8">
            <h2 className="text-lg font-medium text-gray-800 mb-4">System Health</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <HealthCard
                title="API Status"
                status={health.status === 'healthy' ? 'healthy' : 'error'}
                value={health.status === 'healthy' ? 'All systems operational' : 'Issues detected'}
                icon={Activity}
              />
              <HealthCard
                title="Database"
                status={health.database.status === 'connected' ? 'healthy' : 'error'}
                value={
                  health.database.status === 'connected'
                    ? `${health.database.latencyMs}ms latency`
                    : health.database.error || 'Connection failed'
                }
                icon={Database}
              />
              <HealthCard
                title="Active Sessions"
                status="healthy"
                value={`${health.activity.activeSessionsLastHour} in last hour`}
                icon={MessageSquare}
              />
              <HealthCard
                title="Active Users"
                status="healthy"
                value={`${health.activity.activeUsersLastHour} in last hour`}
                icon={Users}
              />
            </div>
          </section>
        )}

        {stats && (
          <>
            {/* Totals */}
            <section className="mb-8">
              <h2 className="text-lg font-medium text-gray-800 mb-4">Totals</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <StatCard title="Total Users" value={stats.totals.users} icon={Users} />
                <StatCard title="Total Sessions" value={stats.totals.sessions} icon={MessageSquare} />
                <StatCard title="Total Agents" value={stats.totals.agents} icon={Bot} />
                <StatCard title="Total Messages" value={stats.totals.messages} icon={MessageSquare} />
                <StatCard title="Agent Messages" value={stats.totals.agentMessages} icon={Bot} />
              </div>
            </section>

            {/* Recent Activity */}
            <section className="mb-8">
              <h2 className="text-lg font-medium text-gray-800 mb-4">Recent Activity</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <StatCard
                  title="New Users Today"
                  value={stats.recent.newUsersToday}
                  subtitle="Last 24 hours"
                  icon={Users}
                />
                <StatCard
                  title="New Users This Week"
                  value={stats.recent.newUsersWeek}
                  subtitle="Last 7 days"
                  icon={Users}
                />
                <StatCard
                  title="New Users This Month"
                  value={stats.recent.newUsersMonth}
                  subtitle="Last 30 days"
                  icon={Users}
                />
                <StatCard
                  title="Sessions Today"
                  value={stats.recent.sessionsToday}
                  subtitle="Last 24 hours"
                  icon={Clock}
                />
                <StatCard
                  title="Messages This Week"
                  value={stats.recent.messagesWeek}
                  subtitle="Last 7 days"
                  icon={MessageSquare}
                />
              </div>
            </section>

            <p className="text-xs text-gray-400">
              Generated at: {new Date(stats.generated).toLocaleString()}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

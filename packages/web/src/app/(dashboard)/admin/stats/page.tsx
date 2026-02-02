'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';

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

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: number;
  subtitle?: string;
}) {
  return (
    <div className="p-4 rounded-lg border border-slate-800 bg-slate-900/50">
      <p className="text-sm text-slate-400">{title}</p>
      <p className="text-3xl font-semibold text-slate-100 mt-1">{value.toLocaleString()}</p>
      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

export default function AdminStatsPage() {
  const router = useRouter();
  const { user, fetchWithAuth } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user && user.role !== 'admin') {
      router.push('/chat');
    }
  }, [user, router]);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
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
    } finally {
      setIsLoading(false);
    }
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
          <h1 className="text-2xl font-semibold text-slate-100">Statistics</h1>
          <Button variant="ghost" onClick={loadStats}>
            Refresh
          </Button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {stats && (
          <>
            {/* Totals */}
            <section className="mb-8">
              <h2 className="text-lg font-medium text-slate-200 mb-4">Totals</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <StatCard title="Total Users" value={stats.totals.users} />
                <StatCard title="Total Sessions" value={stats.totals.sessions} />
                <StatCard title="Total Agents" value={stats.totals.agents} />
                <StatCard title="Total Messages" value={stats.totals.messages} />
                <StatCard title="Agent Messages" value={stats.totals.agentMessages} />
              </div>
            </section>

            {/* Recent Activity */}
            <section className="mb-8">
              <h2 className="text-lg font-medium text-slate-200 mb-4">Recent Activity</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <StatCard
                  title="New Users Today"
                  value={stats.recent.newUsersToday}
                  subtitle="Last 24 hours"
                />
                <StatCard
                  title="New Users This Week"
                  value={stats.recent.newUsersWeek}
                  subtitle="Last 7 days"
                />
                <StatCard
                  title="New Users This Month"
                  value={stats.recent.newUsersMonth}
                  subtitle="Last 30 days"
                />
                <StatCard
                  title="Sessions Today"
                  value={stats.recent.sessionsToday}
                  subtitle="Last 24 hours"
                />
                <StatCard
                  title="Messages This Week"
                  value={stats.recent.messagesWeek}
                  subtitle="Last 7 days"
                />
              </div>
            </section>

            <p className="text-xs text-slate-500">
              Generated at: {new Date(stats.generated).toLocaleString()}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

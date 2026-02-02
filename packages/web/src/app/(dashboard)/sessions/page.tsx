'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';

interface Session {
  id: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  agent?: {
    id: string;
    name: string;
    avatar: string | null;
  } | null;
}

export default function SessionsPage() {
  const { fetchWithAuth } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const response = await fetchWithAuth('/api/v1/sessions');
      const data = await response.json();
      if (data.success) {
        setSessions(data.data.items);
      } else {
        setError(data.error?.message || 'Failed to load sessions');
      }
    } catch {
      setError('Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm('Are you sure you want to delete this session?')) return;

    try {
      const response = await fetchWithAuth(`/api/v1/sessions/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
      }
    } catch {
      setError('Failed to delete session');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400"></div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Sessions</h1>
        <Link href="/chat">
          <Button>New Session</Button>
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-400">No sessions yet</p>
          <Link href="/chat" className="text-sky-400 hover:text-sky-300 mt-2 inline-block">
            Start a new conversation
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between p-4 rounded-lg border border-slate-800 bg-slate-900/50"
            >
              <div className="flex-1">
                <Link
                  href={`/chat?session=${session.id}`}
                  className="text-slate-100 hover:text-sky-400 transition-colors font-medium"
                >
                  {session.label || 'Untitled Session'}
                </Link>
                <p className="text-sm text-slate-500 mt-1">
                  {new Date(session.updatedAt).toLocaleDateString()} at{' '}
                  {new Date(session.updatedAt).toLocaleTimeString()}
                  {session.agent && (
                    <span className="ml-2 text-slate-400">
                      Agent: {session.agent.name}
                    </span>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteSession(session.id)}
                className="text-red-400 hover:text-red-300"
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

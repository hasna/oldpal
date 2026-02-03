'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/Card';

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
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSessions = useCallback(async () => {
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
  }, [fetchWithAuth]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const deleteSession = async (id: string) => {
    try {
      const response = await fetchWithAuth(`/api/v1/sessions/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        toast({
          title: 'Session deleted',
          description: 'The session has been deleted successfully.',
        });
      }
    } catch {
      setError('Failed to delete session');
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex-1">
                  <Skeleton className="h-5 w-48 mb-2" />
                  <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Sessions</h1>
        <Link href="/chat">
          <Button>New Session</Button>
        </Link>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {sessions.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">No sessions yet</p>
          <Link href="/chat" className="text-sky-500 hover:text-sky-600 mt-2 inline-block">
            Start a new conversation
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <Card key={session.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex-1">
                  <Link
                    href={`/chat?session=${session.id}`}
                    className="text-gray-900 hover:text-sky-500 transition-colors font-medium"
                  >
                    {session.label || 'Untitled Session'}
                  </Link>
                  <p className="text-sm text-gray-400 mt-1">
                    {new Date(session.updatedAt).toLocaleDateString()} at{' '}
                    {new Date(session.updatedAt).toLocaleTimeString()}
                    {session.agent && (
                      <span className="ml-2 text-gray-500">
                        Agent: {session.agent.name}
                      </span>
                    )}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:text-red-300"
                    >
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete session?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete this session? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteSession(session.id)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

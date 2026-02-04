'use client';

import { useState, useEffect, useCallback } from 'react';
import { Monitor, Smartphone, Tablet, Trash2, Loader2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';

interface Session {
  id: string;
  device: string;
  browser: string;
  os: string;
  ipAddress: string | null;
  lastUsedAt: string;
  createdAt: string;
}

interface ActiveSessionsProps {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  onSessionsChanged?: () => void;
}

export function ActiveSessions({ fetchWithAuth, onSessionsChanged }: ActiveSessionsProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [isRevokingAll, setIsRevokingAll] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/v1/users/me/sessions');
      const data = await response.json();

      if (data.success) {
        setSessions(data.data.sessions);
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

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      const response = await fetchWithAuth(`/api/v1/users/me/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (data.success) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        onSessionsChanged?.();
      } else {
        setError(data.error?.message || 'Failed to revoke session');
      }
    } catch {
      setError('Failed to revoke session');
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeAllOthers = async () => {
    setIsRevokingAll(true);
    try {
      const response = await fetchWithAuth('/api/v1/users/me/sessions', {
        method: 'DELETE',
      });
      const data = await response.json();

      if (data.success) {
        // Reload sessions - should now show only current
        await loadSessions();
        onSessionsChanged?.();
      } else {
        setError(data.error?.message || 'Failed to revoke sessions');
      }
    } catch {
      setError('Failed to revoke sessions');
    } finally {
      setIsRevokingAll(false);
      setConfirmRevokeAll(false);
    }
  };

  const getDeviceIcon = (device: string) => {
    switch (device.toLowerCase()) {
      case 'mobile':
        return <Smartphone className="h-5 w-5" />;
      case 'tablet':
        return <Tablet className="h-5 w-5" />;
      default:
        return <Monitor className="h-5 w-5" />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  // Identify the most recent session as "current"
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
  );
  const currentSessionId = sortedSessions.length > 0 ? sortedSessions[0].id : null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-60" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Active Sessions
            </CardTitle>
            <CardDescription>
              Devices where you are currently logged in
            </CardDescription>
          </div>
          {sessions.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmRevokeAll(true)}
              disabled={isRevokingAll}
              className="text-destructive hover:text-destructive"
            >
              {isRevokingAll ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <LogOut className="h-4 w-4 mr-2" />
              )}
              Logout All Others
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {sessions.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Monitor className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No active sessions found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedSessions.map((session) => {
              const isCurrent = session.id === currentSessionId;

              return (
                <div
                  key={session.id}
                  className={`flex items-center gap-4 p-4 border rounded-lg ${
                    isCurrent ? 'border-primary/30 bg-primary/5' : ''
                  }`}
                >
                  <div className="text-muted-foreground">
                    {getDeviceIcon(session.device)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {session.browser} on {session.os}
                      </span>
                      {isCurrent && (
                        <Badge variant="secondary" className="text-xs">
                          This device
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {session.device} • {session.ipAddress || 'Unknown IP'} • Last active{' '}
                      {formatDate(session.lastUsedAt)}
                    </div>
                  </div>
                  {!isCurrent && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeSession(session.id)}
                      disabled={revokingId === session.id}
                      className="text-destructive hover:text-destructive/80"
                    >
                      {revokingId === session.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Confirm Revoke All Dialog */}
        <AlertDialog open={confirmRevokeAll} onOpenChange={setConfirmRevokeAll}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Logout all other devices?</AlertDialogTitle>
              <AlertDialogDescription>
                This will sign you out of all devices except this one. You will need to log in again on those devices.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRevokingAll}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRevokeAllOthers}
                disabled={isRevokingAll}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isRevokingAll ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Logging out...
                  </>
                ) : (
                  'Logout All Others'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

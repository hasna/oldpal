'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, Monitor, Smartphone, Tablet, CheckCircle, XCircle, AlertTriangle, Globe } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/Label';

interface LoginEntry {
  id: string;
  success: boolean;
  device: string;
  browser: string;
  os: string;
  ipAddress: string | null;
  country: string | null;
  city: string | null;
  isNewDevice: boolean;
  failureReason: string | null;
  createdAt: string;
}

interface LoginHistoryProps {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

export function LoginHistory({ fetchWithAuth }: LoginHistoryProps) {
  const [logins, setLogins] = useState<LoginEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFailed, setShowFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadLogins = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetchWithAuth(
        `/api/v1/users/me/login-history?page=${page}&limit=10&showFailed=${showFailed}`
      );
      const data = await response.json();

      if (data.success) {
        setLogins(data.data.items);
        setTotalPages(data.data.totalPages || 1);
      } else {
        setError(data.error?.message || 'Failed to load login history');
      }
    } catch {
      setError('Failed to load login history');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, page, showFailed]);

  useEffect(() => {
    loadLogins();
  }, [loadLogins]);

  const getDeviceIcon = (device: string) => {
    switch (device.toLowerCase()) {
      case 'mobile':
        return <Smartphone className="h-4 w-4" />;
      case 'tablet':
        return <Tablet className="h-4 w-4" />;
      default:
        return <Monitor className="h-4 w-4" />;
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
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getFailureReasonText = (reason: string | null) => {
    switch (reason) {
      case 'invalid_password':
        return 'Incorrect password';
      case 'user_not_found':
        return 'Email not found';
      case 'account_locked':
        return 'Account locked';
      default:
        return 'Login failed';
    }
  };

  if (isLoading && logins.length === 0) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-60" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
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
              <Shield className="h-5 w-5" />
              Login History
            </CardTitle>
            <CardDescription>
              Recent sign-in activity on your account
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-failed"
              checked={showFailed}
              onCheckedChange={setShowFailed}
            />
            <Label htmlFor="show-failed" className="text-sm text-muted-foreground">
              Show failed
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {logins.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No login history found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {logins.map((login) => (
              <div
                key={login.id}
                className={`flex items-start gap-3 p-3 border rounded-lg ${
                  !login.success ? 'border-destructive/30 bg-destructive/5' : ''
                }`}
              >
                <div className={`mt-1 ${login.success ? 'text-muted-foreground' : 'text-destructive'}`}>
                  {getDeviceIcon(login.device)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">
                      {login.browser} on {login.os}
                    </span>
                    {login.success ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    {login.isNewDevice && (
                      <Badge variant="secondary" className="text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        New Device
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <span>{formatDate(login.createdAt)}</span>
                    {login.ipAddress && (
                      <>
                        <span>•</span>
                        <span>{login.ipAddress}</span>
                      </>
                    )}
                    {(login.city || login.country) && (
                      <>
                        <span>•</span>
                        <Globe className="h-3 w-3" />
                        <span>{[login.city, login.country].filter(Boolean).join(', ')}</span>
                      </>
                    )}
                  </div>
                  {!login.success && login.failureReason && (
                    <p className="text-sm text-destructive mt-1">
                      {getFailureReasonText(login.failureReason)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || isLoading}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || isLoading}
            >
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

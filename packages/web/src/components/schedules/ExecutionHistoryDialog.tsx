'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, Clock, User, AlertCircle } from 'lucide-react';

interface Execution {
  id: string;
  status: string;
  trigger: string;
  durationMs: number | null;
  result: { summary?: string; output?: string } | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface ExecutionHistoryDialogProps {
  scheduleId: string | null;
  scheduleName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

export function ExecutionHistoryDialog({
  scheduleId,
  scheduleName,
  open,
  onOpenChange,
  fetchWithAuth,
}: ExecutionHistoryDialogProps) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadExecutions = useCallback(async () => {
    if (!scheduleId) return;

    setIsLoading(true);
    setError('');

    try {
      const response = await fetchWithAuth(`/api/v1/schedules/${scheduleId}/executions?limit=50`);
      const data = await response.json();

      if (data.success) {
        setExecutions(data.data.items);
      } else {
        setError(data.error?.message || 'Failed to load execution history');
      }
    } catch {
      setError('Failed to load execution history');
    } finally {
      setIsLoading(false);
    }
  }, [scheduleId, fetchWithAuth]);

  useEffect(() => {
    if (open && scheduleId) {
      loadExecutions();
    }
  }, [open, scheduleId, loadExecutions]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failure':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'timeout':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null || ms === undefined) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms / 60000)}m`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Execution History</DialogTitle>
          <DialogDescription>
            {scheduleName ? `Recent executions of "${scheduleName}"` : 'Recent executions'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <ScrollArea className="h-[400px] pr-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3 p-3 border rounded-lg">
                  <Skeleton className="h-4 w-4" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : executions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No execution history yet. Run the schedule to see results here.
            </div>
          ) : (
            <div className="space-y-3">
              {executions.map((execution) => (
                <div
                  key={execution.id}
                  className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="mt-0.5">{getStatusIcon(execution.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {new Date(execution.startedAt).toLocaleString()}
                      </span>
                      <Badge variant={execution.status === 'success' ? 'success' : 'error'} className="text-xs">
                        {execution.status}
                      </Badge>
                      {execution.trigger === 'manual' && (
                        <Badge variant="secondary" className="text-xs">
                          <User className="h-3 w-3 mr-1" />
                          Manual
                        </Badge>
                      )}
                      {execution.durationMs !== null && (
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(execution.durationMs)}
                        </span>
                      )}
                    </div>
                    {execution.result?.summary && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {execution.result.summary}
                      </p>
                    )}
                    {execution.error && (
                      <p className="text-sm text-destructive mt-1">
                        {execution.error}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Wrench, Brain, CheckCircle, XCircle } from 'lucide-react';
import { useChatStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface ToolCallStatus {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  elapsed: number;
}

export function ProcessingIndicator() {
  const { isStreaming, currentToolCalls } = useChatStore();
  const [toolStatuses, setToolStatuses] = useState<ToolCallStatus[]>([]);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const [streamingStartTime, setStreamingStartTime] = useState<number | null>(null);

  // Track streaming start time
  useEffect(() => {
    if (isStreaming && !streamingStartTime) {
      setStreamingStartTime(Date.now());
    } else if (!isStreaming) {
      setStreamingStartTime(null);
      setThinkingElapsed(0);
    }
  }, [isStreaming, streamingStartTime]);

  // Update thinking elapsed time
  useEffect(() => {
    if (!isStreaming || !streamingStartTime) return;

    const interval = setInterval(() => {
      setThinkingElapsed(Math.floor((Date.now() - streamingStartTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [isStreaming, streamingStartTime]);

  // Update tool call statuses
  useEffect(() => {
    const statuses: ToolCallStatus[] = currentToolCalls.map((call) => {
      const startedAt = call.startedAt ?? Date.now();
      const hasResult = !!call.result;
      const isError = call.result?.isError ?? false;

      return {
        id: call.id,
        name: call.name,
        status: hasResult ? (isError ? 'error' : 'completed') : 'running',
        elapsed: hasResult ? 0 : Math.floor((Date.now() - startedAt) / 1000),
      };
    });
    setToolStatuses(statuses);

    // Update running tool elapsed times
    if (statuses.some((s) => s.status === 'running')) {
      const interval = setInterval(() => {
        setToolStatuses((prev) =>
          prev.map((status) => {
            if (status.status !== 'running') return status;
            const call = currentToolCalls.find((c) => c.id === status.id);
            if (!call || call.result) return status;
            const startedAt = call.startedAt ?? Date.now();
            return {
              ...status,
              elapsed: Math.floor((Date.now() - startedAt) / 1000),
            };
          })
        );
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [currentToolCalls]);

  if (!isStreaming) return null;

  const runningTools = toolStatuses.filter((s) => s.status === 'running');
  const hasRunningTools = runningTools.length > 0;

  return (
    <div className="flex flex-col gap-2 px-6 py-3 border-b border-border bg-gradient-to-r from-sky-50/50 to-indigo-50/50 dark:from-sky-950/30 dark:to-indigo-950/30">
      {/* Main status indicator */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {hasRunningTools ? (
            <>
              <Wrench className="h-4 w-4 text-sky-600 animate-pulse" />
              <span className="text-sm font-medium text-sky-700">
                Running tool: {runningTools[0].name}
              </span>
            </>
          ) : (
            <>
              <Brain className="h-4 w-4 text-indigo-600 animate-pulse" />
              <span className="text-sm font-medium text-indigo-700">Thinking...</span>
            </>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {hasRunningTools ? `${runningTools[0].elapsed}s` : `${thinkingElapsed}s`}
        </span>
        <Loader2 className="h-3 w-3 text-muted-foreground animate-spin ml-auto" />
      </div>

      {/* Tool call summary */}
      {toolStatuses.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {toolStatuses.map((status) => (
            <div
              key={status.id}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium',
                status.status === 'running' && 'bg-sky-100 text-sky-700',
                status.status === 'completed' && 'bg-green-100 text-green-700',
                status.status === 'error' && 'bg-rose-100 text-rose-700'
              )}
            >
              {status.status === 'running' && (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              )}
              {status.status === 'completed' && (
                <CheckCircle className="h-2.5 w-2.5" />
              )}
              {status.status === 'error' && (
                <XCircle className="h-2.5 w-2.5" />
              )}
              <span className="font-mono">{status.name}</span>
              {status.status === 'running' && status.elapsed > 0 && (
                <span className="opacity-70">{status.elapsed}s</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

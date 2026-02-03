'use client';

import { useEffect, useState } from 'react';
import type { ToolCall, ToolResult } from '@hasna/assistants-shared';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { FilePreview } from './FilePreview';

interface ToolCallCardProps {
  call: ToolCall;
  result?: ToolResult;
}

export function ToolCallCard({ call, result }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const startedAt = !result && 'startedAt' in call
    ? Number((call as { startedAt?: number }).startedAt)
    : null;
  const isRunning = Number.isFinite(startedAt);
  const [elapsed, setElapsed] = useState(0);
  const isError = result?.isError;
  const accentClass = isError
    ? 'border-rose-500/50 shadow-[0_0_30px_-18px_rgba(244,63,94,0.6)]'
    : 'border-sky-500/40 shadow-[0_0_30px_-18px_rgba(56,189,248,0.5)]';
  const filePath = call.name === 'read'
    ? String((call.input as Record<string, unknown>)?.path || (call.input as Record<string, unknown>)?.file_path || '')
    : '';

  useEffect(() => {
    if (!isRunning || startedAt === null) {
      return;
    }
    const tick = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    const timeout = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [isRunning, startedAt]);

  return (
    <Card className={cn('mt-3 overflow-hidden border-l-4', accentClass)}>
      <CardHeader
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Tool call: ${call.name}. ${expanded ? 'Collapse' : 'Expand'} details`}
        className="cursor-pointer justify-between gap-4 bg-gray-50 text-sm"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-sky-500/20 px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-sky-700">
            {call.name}
          </span>
          {isError && <Badge variant="error">Error</Badge>}
          {isRunning && elapsed > 0 && (
            <span className="text-[11px] uppercase tracking-wide text-gray-500">
              {elapsed}s
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">{expanded ? 'Hide' : 'Show'}</span>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3 text-xs text-gray-800">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Input</p>
            <pre className="mt-2 overflow-auto rounded-lg bg-gray-100 p-3">
              {JSON.stringify(call.input, null, 2)}
            </pre>
          </div>
          {result && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Output</p>
              {call.name === 'read' && filePath && !isError ? (
                <FilePreview path={filePath} content={result.content} />
              ) : (
                <pre
                  className={cn(
                    'mt-2 overflow-auto rounded-lg p-3',
                    isError ? 'bg-rose-100 text-rose-800' : 'bg-gray-100'
                  )}
                >
                  {result.content}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

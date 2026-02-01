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
  const [elapsed, setElapsed] = useState(0);
  const isError = result?.isError;
  const accentClass = isError
    ? 'border-rose-500/50 shadow-[0_0_30px_-18px_rgba(244,63,94,0.6)]'
    : 'border-sky-500/40 shadow-[0_0_30px_-18px_rgba(56,189,248,0.5)]';
  const filePath = call.name === 'read'
    ? String((call.input as Record<string, unknown>)?.path || (call.input as Record<string, unknown>)?.file_path || '')
    : '';

  useEffect(() => {
    if (result || !('startedAt' in call)) {
      setElapsed(0);
      return;
    }
    const startedAt = Number((call as { startedAt?: number }).startedAt);
    if (!Number.isFinite(startedAt)) {
      setElapsed(0);
      return;
    }
    const tick = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [call, result]);

  return (
    <Card className={cn('mt-3 overflow-hidden border-l-4', accentClass)}>
      <CardHeader
        className="cursor-pointer justify-between gap-4 bg-gradient-to-r from-slate-950/60 via-slate-900/80 to-slate-950/40 text-sm"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-sky-500/20 px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-sky-100">
            {call.name}
          </span>
          {isError && <Badge variant="error">Error</Badge>}
          {!result && elapsed > 0 && (
            <span className="text-[11px] uppercase tracking-wide text-slate-400">
              {elapsed}s
            </span>
          )}
        </div>
        <span className="text-xs text-slate-400">{expanded ? 'Hide' : 'Show'}</span>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3 text-xs text-slate-200">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Input</p>
            <pre className="mt-2 overflow-auto rounded-lg bg-slate-950/60 p-3">
              {JSON.stringify(call.input, null, 2)}
            </pre>
          </div>
          {result && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Output</p>
              {call.name === 'read' && filePath && !isError ? (
                <FilePreview path={filePath} content={result.content} />
              ) : (
                <pre
                  className={cn(
                    'mt-2 overflow-auto rounded-lg p-3',
                    isError ? 'bg-rose-500/10 text-rose-100' : 'bg-slate-950/60'
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

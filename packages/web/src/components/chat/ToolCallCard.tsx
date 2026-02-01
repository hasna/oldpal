'use client';

import { useState } from 'react';
import type { ToolCall, ToolResult } from '@oldpal/shared';
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
  const isError = result?.isError;
  const filePath = call.name === 'read'
    ? String((call.input as Record<string, unknown>)?.path || (call.input as Record<string, unknown>)?.file_path || '')
    : '';

  return (
    <Card className="mt-3 shadow-glow">
      <CardHeader
        className="cursor-pointer justify-between gap-4 text-sm"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-sky-500/20 px-2 py-1 font-mono text-xs text-sky-200">
            {call.name}
          </span>
          {isError && <Badge variant="error">Error</Badge>}
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

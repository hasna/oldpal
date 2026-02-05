'use client';

import { useEffect, useState, useRef } from 'react';
import type { ToolCall, ToolResult } from '@hasna/assistants-shared';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { FilePreview } from './FilePreview';
import { Loader2, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Parse error content to extract meaningful error info
 */
interface ErrorInfo {
  type: string;
  message: string;
  exitCode?: number;
  hint?: string;
}

function parseErrorInfo(content: string): ErrorInfo {
  const lowerContent = content.toLowerCase();

  // Extract exit code if present
  const exitCodeMatch = content.match(/exit(?:ed with)?\s*(?:code|status)?\s*(\d+)/i)
    || content.match(/code\s*[:=]\s*(\d+)/i);
  const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : undefined;

  // File system errors
  if (lowerContent.includes('enoent') || lowerContent.includes('no such file')) {
    return { type: 'not_found', message: 'File not found', exitCode, hint: 'Check the path exists' };
  }
  if (lowerContent.includes('eacces') || lowerContent.includes('permission denied')) {
    return { type: 'permission', message: 'Permission denied', exitCode, hint: 'Check file permissions' };
  }

  // Network errors
  if (lowerContent.includes('etimedout') || lowerContent.includes('timeout') || lowerContent.includes('timed out')) {
    return { type: 'timeout', message: 'Request timed out', exitCode, hint: 'Try again' };
  }
  if (lowerContent.includes('econnrefused') || lowerContent.includes('connection refused')) {
    return { type: 'connection', message: 'Connection refused', exitCode, hint: 'Check if server is running' };
  }

  // HTTP errors
  const httpMatch = content.match(/(\d{3})\s*(Unauthorized|Forbidden|Not Found|Bad Request)/i)
    || content.match(/HTTP\s*(?:error|status)?\s*[:=]?\s*(\d{3})/i);
  if (httpMatch) {
    const code = parseInt(httpMatch[1], 10);
    const messages: Record<number, { message: string; hint: string }> = {
      400: { message: 'Bad request', hint: 'Check parameters' },
      401: { message: 'Unauthorized', hint: 'Check credentials' },
      403: { message: 'Forbidden', hint: 'Check permissions' },
      404: { message: 'Not found', hint: 'Check the URL' },
      429: { message: 'Rate limited', hint: 'Wait before retrying' },
      500: { message: 'Server error', hint: 'Try again later' },
    };
    const info = messages[code] || { message: `HTTP ${code}`, hint: 'Check error details' };
    return { type: 'http', message: info.message, exitCode: code, hint: info.hint };
  }

  // Command not found
  if (lowerContent.includes('command not found') || lowerContent.includes('not recognized')) {
    return { type: 'command', message: 'Command not found', exitCode: exitCode ?? 127, hint: 'Install the command' };
  }

  // Tool denied
  if (lowerContent.includes('denied') || lowerContent.includes('blocked')) {
    return { type: 'denied', message: 'Tool denied', exitCode, hint: 'Check allowed tools' };
  }

  // Generic with exit code
  if (exitCode !== undefined) {
    return { type: 'exit', message: `Exit code ${exitCode}`, exitCode, hint: 'Check output details' };
  }

  return { type: 'unknown', message: 'Error', hint: 'Check details' };
}

/**
 * Format duration in a human-friendly way
 * - Under 1 minute: "42s"
 * - Under 1 hour: "5m 32s"
 * - 1 hour or more: "1h 21m 32s"
 */
function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

interface ToolCallCardProps {
  call: ToolCall;
  result?: ToolResult;
}

type ToolStatus = 'pending' | 'running' | 'completed' | 'error';

export function ToolCallCard({ call, result }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const startedAt = 'startedAt' in call
    ? Number((call as { startedAt?: number }).startedAt)
    : null;
  const hasStarted = Number.isFinite(startedAt);
  const isRunning = hasStarted && !result;
  const [elapsed, setElapsed] = useState(0);
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null);
  const isError = result?.isError;
  const errorInfo = isError && result?.content ? parseErrorInfo(result.content) : null;

  // Determine tool status
  const status: ToolStatus = result
    ? isError
      ? 'error'
      : 'completed'
    : hasStarted
      ? 'running'
      : 'pending';

  const accentClass = {
    pending: 'border-border',
    running: 'border-sky-500/40 shadow-[0_0_30px_-18px_rgba(56,189,248,0.5)]',
    completed: 'border-green-500/40 shadow-[0_0_30px_-18px_rgba(34,197,94,0.5)]',
    error: 'border-rose-500/50 shadow-[0_0_30px_-18px_rgba(244,63,94,0.6)]',
  }[status];

  const filePath = call.name === 'read'
    ? String((call.input as Record<string, unknown>)?.path || (call.input as Record<string, unknown>)?.file_path || '')
    : '';

  // Track elapsed time
  useEffect(() => {
    if (startedAt === null || !hasStarted) {
      return;
    }

    // If we have a result, compute and freeze the final elapsed time
    if (result) {
      if (finalElapsed === null) {
        setFinalElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      }
      return;
    }

    const tick = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [hasStarted, startedAt, result, finalElapsed]);

  const displayElapsed = finalElapsed ?? elapsed;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard errors
    }
  };

  const StatusIcon = {
    pending: Clock,
    running: Loader2,
    completed: CheckCircle,
    error: XCircle,
  }[status];

  return (
    <Card className={cn('mt-3 overflow-hidden border-l-4 transition-all', accentClass)}>
      <CardHeader
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Tool call: ${call.name}. ${expanded ? 'Collapse' : 'Expand'} details`}
        className="cursor-pointer justify-between gap-4 bg-muted text-sm py-2"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <div className="flex items-center gap-3">
          {/* Status icon */}
          <StatusIcon
            className={cn(
              'h-4 w-4',
              status === 'pending' && 'text-muted-foreground',
              status === 'running' && 'text-sky-600 animate-spin',
              status === 'completed' && 'text-green-600',
              status === 'error' && 'text-rose-600'
            )}
          />
          {/* Tool name */}
          <span className="rounded-full bg-sky-500/20 px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-sky-700">
            {call.name}
          </span>
          {/* Status badge */}
          <Badge
            className={cn(
              'text-[10px]',
              status === 'pending' && 'bg-muted text-muted-foreground',
              status === 'running' && 'bg-sky-100 text-sky-700',
              status === 'completed' && 'bg-green-100 text-green-700',
              status === 'error' && 'bg-rose-100 text-rose-700'
            )}
          >
            {status === 'pending' && 'Queued'}
            {status === 'running' && 'Running'}
            {status === 'completed' && 'Succeeded'}
            {status === 'error' && 'Failed'}
          </Badge>
          {/* Elapsed time */}
          {(status === 'running' || status === 'completed' || status === 'error') && displayElapsed > 0 && (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(displayElapsed)}
            </span>
          )}
          {/* Error summary - visible without expanding */}
          {errorInfo && (
            <span className="text-[11px] text-rose-600 flex items-center gap-1">
              <span>·</span>
              <span>{errorInfo.message}</span>
              {errorInfo.exitCode !== undefined && (
                <span className="text-rose-500">[{errorInfo.exitCode}]</span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{expanded ? 'Hide' : 'Show'}</span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3 text-xs text-foreground">
          {/* Metadata section */}
          {(displayElapsed > 0 || errorInfo) && (
            <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground border-b pb-2">
              {displayElapsed > 0 && (
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>Duration: {formatDuration(displayElapsed)}</span>
                </div>
              )}
              {errorInfo?.exitCode !== undefined && (
                <div className="flex items-center gap-1 text-rose-600">
                  <XCircle className="h-3 w-3" />
                  <span>Exit code: {errorInfo.exitCode}</span>
                </div>
              )}
              {errorInfo?.type && errorInfo.type !== 'unknown' && (
                <div className="flex items-center gap-1 text-rose-600">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Error type: {errorInfo.type.replace(/_/g, ' ')}</span>
                </div>
              )}
            </div>
          )}
          {/* Input section */}
          <div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Input</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(JSON.stringify(call.input, null, 2));
                }}
              >
                {copied ? (
                  <Check className="h-3 w-3 mr-1" />
                ) : (
                  <Copy className="h-3 w-3 mr-1" />
                )}
                Copy
              </Button>
            </div>
            <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 max-h-40 text-[11px]">
              {JSON.stringify(call.input, null, 2)}
            </pre>
          </div>
          {/* Output section */}
          {result && (
            <div>
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setOutputExpanded(!outputExpanded);
                }}
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Output {result.content.length > 500 && (
                    <span>
                      ({result.content.split('\n').length.toLocaleString()} lines, {result.content.length.toLocaleString()} chars)
                      {result.truncated && <span className="text-amber-600 ml-1">• truncated</span>}
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(result.content);
                    }}
                  >
                    {copied ? (
                      <Check className="h-3 w-3 mr-1" />
                    ) : (
                      <Copy className="h-3 w-3 mr-1" />
                    )}
                    Copy
                  </Button>
                  {result.content.length > 200 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                    >
                      {outputExpanded ? 'Collapse' : 'Expand'}
                      {outputExpanded ? (
                        <ChevronUp className="h-3 w-3 ml-1" />
                      ) : (
                        <ChevronDown className="h-3 w-3 ml-1" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
              {call.name === 'read' && filePath && !isError ? (
                <FilePreview path={filePath} content={result.content} />
              ) : (
                <>
                  <pre
                    className={cn(
                      'mt-2 overflow-auto rounded-lg p-3 text-[11px] transition-all',
                      isError ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' : 'bg-muted',
                      outputExpanded ? 'max-h-96' : 'max-h-24'
                    )}
                  >
                    {result.content}
                  </pre>
                  {/* Error hint with action suggestion */}
                  {errorInfo?.hint && (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      <span>Hint: {errorInfo.hint}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {/* Running indicator when no result yet */}
          {status === 'running' && (
            <div className="flex items-center gap-2 text-sky-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[11px]">Executing tool...</span>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

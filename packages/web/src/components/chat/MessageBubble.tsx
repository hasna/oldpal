import type { Message, ToolCall, ToolResult } from '@oldpal/shared';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolCallCard } from './ToolCallCard';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  toolResults?: ToolResult[];
}

export function MessageBubble({ message, isStreaming, toolResults }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const toolCalls = message.toolCalls ?? [];

  return (
    <div className={cn('flex w-full gap-4', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/20 text-sm font-semibold text-sky-200">
          OP
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl border px-5 py-4 text-sm shadow-glow',
          isUser
            ? 'border-sky-400/30 bg-sky-500/20 text-slate-100'
            : 'border-slate-800 bg-slate-900/70 text-slate-100'
        )}
      >
        <MarkdownRenderer content={message.content} />
        {!isUser && toolCalls.length > 0 && (
          <div className="mt-4 space-y-3">
            {toolCalls.map((call) => {
              const result = toolResults?.find((res) => res.toolCallId === call.id);
              return <ToolCallCard key={call.id} call={call as ToolCall} result={result} />;
            })}
          </div>
        )}
        {isStreaming && (
          <span className="mt-3 inline-block h-4 w-2 animate-pulse rounded-sm bg-sky-300 align-middle" />
        )}
      </div>
    </div>
  );
}

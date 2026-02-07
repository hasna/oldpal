import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolCallCard } from './ToolCallCard';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  toolResults?: ToolResult[];
  isDraft?: boolean;
}

export function MessageBubble({ message, isStreaming, toolResults, isDraft }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const toolCalls = message.toolCalls ?? [];

  return (
    <div className={cn('flex w-full gap-4', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500/20 text-sm font-semibold text-sky-600">
          OP
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl border px-5 py-4 text-sm shadow-sm',
          isUser
            ? 'border-sky-400/30 bg-sky-500 text-white'
            : 'border-gray-200 bg-gray-100 text-gray-900',
          isDraft && 'border-dashed opacity-80'
        )}
      >
        {isDraft && (
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-white/80">
            Live dictation
          </div>
        )}
        <MarkdownRenderer content={message.content} variant={isUser ? 'user' : 'assistant'} />
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

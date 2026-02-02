'use client';

import type { Message } from '@hasna/assistants-shared';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '@/lib/store';
import type { ToolCall, ToolResult } from '@hasna/assistants-shared';

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const { isStreaming, currentToolCalls, currentStreamMessageId } = useChatStore();
  const currentToolCallResults = (currentToolCalls as Array<ToolCall & { result?: ToolResult }>)
    .map((call) => call.result)
    .filter((result): result is ToolResult => Boolean(result));

  return (
    <div className="flex flex-col gap-6">
      {messages.map((message, index) => {
        const isLast = index === messages.length - 1;
        const toolResults = message.toolResults ?? [];
        const toolCalls = message.toolCalls ?? [];
        const isStreamingMessage =
          isStreaming &&
          message.role === 'assistant' &&
          (currentStreamMessageId ? message.id === currentStreamMessageId : isLast);
        const shouldUseStreamingCalls = isStreamingMessage && toolCalls.length === 0;
        const mergedToolCalls = shouldUseStreamingCalls ? currentToolCalls : toolCalls;
        const mergedToolResults =
          shouldUseStreamingCalls && currentToolCallResults.length > 0
            ? currentToolCallResults
            : toolResults;

        return (
          <MessageBubble
            key={message.id}
            message={{ ...message, toolCalls: mergedToolCalls }}
            toolResults={mergedToolResults}
            isStreaming={isStreamingMessage}
          />
        );
      })}
    </div>
  );
}

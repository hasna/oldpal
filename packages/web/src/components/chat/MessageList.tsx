'use client';

import type { Message } from '@hasna/assistants-shared';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '@/lib/store';

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const { isStreaming, currentToolCalls } = useChatStore();

  return (
    <div className="flex flex-col gap-6">
      {messages.map((message, index) => {
        const isLast = index === messages.length - 1;
        const toolResults = message.toolResults ?? [];
        const toolCalls = message.toolCalls ?? [];
        const mergedToolCalls =
          toolCalls.length > 0 || !isLast || message.role !== 'assistant'
            ? toolCalls
            : currentToolCalls;

        return (
          <MessageBubble
            key={message.id}
            message={{ ...message, toolCalls: mergedToolCalls }}
            toolResults={toolResults}
            isStreaming={isStreaming && isLast && message.role === 'assistant'}
          />
        );
      })}
    </div>
  );
}

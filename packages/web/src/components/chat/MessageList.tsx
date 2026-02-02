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
        const mergedToolCalls = isStreamingMessage
          ? mergeToolCalls(toolCalls, currentToolCalls)
          : toolCalls;
        const mergedToolResults = isStreamingMessage
          ? mergeToolResults(toolResults, currentToolCallResults)
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

function mergeToolCalls(existing: ToolCall[], incoming: ToolCall[]): ToolCall[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((call) => call.id));
  const merged = [...existing];
  for (const call of incoming) {
    if (!seen.has(call.id)) {
      merged.push(call);
      seen.add(call.id);
    }
  }
  return merged;
}

function mergeToolResults(existing: ToolResult[], incoming: ToolResult[]): ToolResult[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((result) => result.toolCallId));
  const merged = [...existing];
  for (const result of incoming) {
    if (!seen.has(result.toolCallId)) {
      merged.push(result);
      seen.add(result.toolCallId);
    }
  }
  return merged;
}

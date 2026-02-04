'use client';

import { useEffect } from 'react';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { ProcessingIndicator } from './ProcessingIndicator';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';
import { useAuth } from '@/hooks/use-auth';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ChatContainer() {
  const { messages, sessionId } = useChatStore();
  const { accessToken } = useAuth();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      // Don't put token in URL - it gets logged by servers/proxies
      // Token is sent as first message after connection instead
      const url = `${protocol}://${window.location.host}/api/v1/ws`;
      chatWs.connect(url, accessToken);
    }
    return () => {
      chatWs.disconnect();
    };
  }, [accessToken]);

  useEffect(() => {
    if (sessionId) {
      chatWs.send({ type: 'session', sessionId });
    }
  }, [sessionId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Processing indicator - shows when agent is working */}
      <ProcessingIndicator />
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-8">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
              <p className="text-lg font-semibold text-gray-800">Assistants Web</p>
              <p className="mt-2 max-w-md">
                Start a conversation. Tool calls and files will show here with rich previews.
              </p>
            </div>
          ) : (
            <MessageList messages={messages} />
          )}
        </div>
      </ScrollArea>
      <InputArea />
      {/* Status bar - session info */}
      {sessionId && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-1 text-[10px] text-gray-400">
          Session: {sessionId}
        </div>
      )}
    </div>
  );
}

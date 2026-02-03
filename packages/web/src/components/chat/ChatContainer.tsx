'use client';

import { useEffect } from 'react';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
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
      const url = new URL(`${protocol}://${window.location.host}/api/ws`);
      if (accessToken) {
        url.searchParams.set('token', accessToken);
      }
      chatWs.connect(url.toString());
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
    </div>
  );
}

'use client';

import { useEffect } from 'react';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';

export function ChatContainer() {
  const { messages, sessionId } = useChatStore();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      chatWs.connect(`${protocol}://${window.location.host}/api/ws`);
    }
    return () => {
      chatWs.disconnect();
    };
  }, []);

  useEffect(() => {
    if (sessionId) {
      chatWs.send({ type: 'session', sessionId });
    }
  }, [sessionId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-8">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
            <p className="text-lg font-semibold text-slate-200">Assistants Web</p>
            <p className="mt-2 max-w-md">
              Start a conversation. Tool calls and files will show here with rich previews.
            </p>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
      </div>
      <InputArea />
    </div>
  );
}

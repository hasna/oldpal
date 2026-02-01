'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';
import { now, generateId } from '@hasna/assistants-shared';

export function InputArea() {
  const [value, setValue] = useState('');
  const { addMessage, setStreaming, sessionId, createSession, isStreaming } = useChatStore();

  const sendMessage = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const effectiveSessionId = sessionId ?? createSession();

    const userMessage = {
      id: generateId(),
      role: 'user' as const,
      content: trimmed,
      timestamp: now(),
    };
    addMessage(userMessage);

    const assistantId = generateId();
    const assistantMessage = {
      id: assistantId,
      role: 'assistant' as const,
      content: '',
      timestamp: now(),
    };
    addMessage(assistantMessage);

    setStreaming(true);
    chatWs.send({ type: 'message', content: trimmed, sessionId: effectiveSessionId, messageId: assistantId });
    setValue('');
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isStreaming && sessionId) {
        chatWs.send({ type: 'cancel', sessionId });
        setStreaming(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isStreaming, sessionId, setStreaming]);

  return (
    <div className="flex items-center gap-3 border-t border-slate-800 bg-slate-950/80 px-6 py-4">
      <div className="flex-1">
        <Input
          placeholder="Ask Assistants anything..."
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
        />
      </div>
      {isStreaming && sessionId && (
        <Button
          variant="outline"
          onClick={() => {
            chatWs.send({ type: 'cancel', sessionId });
            setStreaming(false);
          }}
        >
          Stop
        </Button>
      )}
      <Button onClick={sendMessage}>Send</Button>
      {sessionId && (
        <span className="text-xs text-slate-500">id {sessionId}</span>
      )}
    </div>
  );
}

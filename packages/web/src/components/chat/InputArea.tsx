'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';
import { now, generateId } from '@oldpal/shared';

export function InputArea() {
  const [value, setValue] = useState('');
  const { addMessage, setStreaming, sessionId } = useChatStore();

  const sendMessage = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const userMessage = {
      id: generateId(),
      role: 'user' as const,
      content: trimmed,
      timestamp: now(),
    };
    addMessage(userMessage);

    const assistantMessage = {
      id: generateId(),
      role: 'assistant' as const,
      content: '',
      timestamp: now(),
    };
    addMessage(assistantMessage);

    setStreaming(true);
    chatWs.send({ type: 'message', content: trimmed, sessionId: sessionId ?? undefined });
    setValue('');
  };

  return (
    <div className="flex items-center gap-3 border-t border-slate-800 bg-slate-950/80 px-6 py-4">
      <Input
        placeholder="Ask Oldpal anything..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
          }
        }}
      />
      <Button onClick={sendMessage}>Send</Button>
    </div>
  );
}

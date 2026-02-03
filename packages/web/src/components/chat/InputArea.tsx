'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/textarea';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';
import { now, generateId } from '@hasna/assistants-shared';

export function InputArea() {
  const [value, setValue] = useState('');
  const { addMessage, setStreaming, sessionId, createSession, isStreaming, finalizeToolCalls, clearToolCalls } = useChatStore();

  const sendMessage = () => {
    // Prevent concurrent sends while streaming to avoid corrupting tool-call state
    if (isStreaming) return;
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
        // Clean up tool call state since server may not send completion
        finalizeToolCalls();
        clearToolCalls();
        setStreaming(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isStreaming, sessionId, setStreaming, finalizeToolCalls, clearToolCalls]);

  return (
    <div className="flex items-end gap-3 border-t border-gray-200 bg-white px-6 py-4">
      <div className="flex-1">
        <Textarea
          id="chat-input"
          aria-label="Message input"
          placeholder="Ask Assistants anything..."
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          className="min-h-[44px] max-h-[200px] resize-none"
          rows={1}
        />
      </div>
      {isStreaming && sessionId && (
        <Button
          variant="outline"
          onClick={() => {
            chatWs.send({ type: 'cancel', sessionId });
            // Clean up tool call state since server may not send completion
            finalizeToolCalls();
            clearToolCalls();
            setStreaming(false);
          }}
        >
          Stop
        </Button>
      )}
      <Button onClick={sendMessage} disabled={isStreaming || !value.trim()}>
        {isStreaming ? 'Streaming...' : 'Send'}
      </Button>
    </div>
  );
}

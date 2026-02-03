'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const { fetchWithAuth } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const safeSearchParams = searchParams ?? new URLSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const requestedSession = safeSearchParams.get('session');

  useEffect(() => {
    if (!requestedSession || requestedSession === sessionId) return;

    let isActive = true;
    const controller = new AbortController();

    setLoadError('');
    setSessionId(requestedSession);
    setMessages([]);

    const loadHistory = async () => {
      try {
        const response = await fetchWithAuth(`/api/v1/chat/${requestedSession}?limit=100`, {
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          if (isActive) {
            setLoadError(data?.error?.message || 'Failed to load chat history');
          }
          return;
        }
        const items = (data.data?.items || []) as Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
        if (isActive) {
          setMessages(
            items.map((item) => ({
              id: item.id,
              role: item.role,
              content: item.content,
            }))
          );
        }
      } catch (error) {
        if (!isActive || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }
        setLoadError('Failed to load chat history');
      }
    };

    loadHistory();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [fetchWithAuth, requestedSession, sessionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetchWithAuth('/api/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: input,
          sessionId,
        }),
      });

      // Get session ID from header
      const newSessionId = response.headers.get('X-Session-Id');
      if (newSessionId) {
        setSessionId(newSessionId);
        const nextParams = new URLSearchParams(safeSearchParams);
        nextParams.set('session', newSessionId);
        router.replace(`/chat?${nextParams.toString()}`);
      }

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const errorMessage = data?.error?.message || 'Failed to send message';
        setMessages((prev) => {
          const updated = [...prev];
          const lastMessage = updated[updated.length - 1];
          if (lastMessage.role === 'assistant') {
            lastMessage.content = `Error: ${errorMessage}`;
          }
          return updated;
        });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setMessages((prev) => {
          const updated = [...prev];
          const lastMessage = updated[updated.length - 1];
          if (lastMessage.role === 'assistant') {
            lastMessage.content = 'Failed to read server response';
          }
          return updated;
        });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'text_delta') {
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastMessage = updated[updated.length - 1];
                  if (lastMessage.role === 'assistant') {
                    lastMessage.content += data.content;
                  }
                  return updated;
                });
              } else if (data.type === 'error') {
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastMessage = updated[updated.length - 1];
                  if (lastMessage.role === 'assistant') {
                    lastMessage.content = `Error: ${data.message}`;
                  }
                  return updated;
                });
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      setMessages((prev) => {
        const updated = [...prev];
        const lastMessage = updated[updated.length - 1];
        if (lastMessage.role === 'assistant') {
          lastMessage.content = 'Failed to connect to the server';
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loadError ? (
          <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {loadError}
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-gray-800">Start a conversation</h2>
              <p className="mt-2 text-gray-500">Send a message to begin chatting with your assistant</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-2xl rounded-lg px-4 py-2 ${
                  message.role === 'user'
                    ? 'bg-sky-500 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content || '...'}</p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4">
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-4xl mx-auto">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={isStreaming}
            className="flex-1"
          />
          <Button type="submit" disabled={isStreaming || !input.trim()}>
            {isStreaming ? 'Sending...' : 'Send'}
          </Button>
        </form>
      </div>
    </div>
  );
}

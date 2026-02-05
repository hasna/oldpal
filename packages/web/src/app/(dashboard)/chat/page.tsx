'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToolCallCard } from '@/components/chat/ToolCallCard';
import {
  ChatSettingsDrawer,
  ChatSettingsButton,
  useChatSettings,
} from '@/components/chat/ChatSettings';
import type { ToolCall, ToolResult } from '@hasna/assistants-shared';

interface ToolCallWithMeta extends ToolCall {
  result?: ToolResult;
  startedAt?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallWithMeta[];
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const streamAbortRef = useRef<AbortController | null>(null);

  // Chat settings
  const { settings, updateSettings, resetSettings, loaded: settingsLoaded } = useChatSettings();

  // Track mounted state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any ongoing stream when unmounting
      streamAbortRef.current?.abort();
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const requestedSession = safeSearchParams.get('session');

  useEffect(() => {
    // When navigating to /chat without a session param, reset to start fresh
    if (!requestedSession) {
      if (sessionId !== null) {
        setSessionId(null);
        setMessages([]);
        setLoadError('');
      }
      return;
    }

    if (requestedSession === sessionId) return;

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

    // Abort any previous streaming request
    streamAbortRef.current?.abort();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

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
          model: settings.model,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
        }),
        signal: abortController.signal,
      });

      // Check if unmounted after fetch
      if (!isMountedRef.current) return;

      // Get session ID from header - only update URL if sessionId actually changed
      const newSessionId = response.headers.get('X-Session-Id');
      if (newSessionId && newSessionId !== sessionId) {
        setSessionId(newSessionId);
        const nextParams = new URLSearchParams(safeSearchParams);
        nextParams.set('session', newSessionId);
        // Use scroll: false to prevent scroll position reset
        router.replace(`/chat?${nextParams.toString()}`, { scroll: false });
      }

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const errorMessage = data?.error?.message || 'Failed to send message';
        if (!isMountedRef.current) return;
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
        if (!isMountedRef.current) return;
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
        // Check if unmounted or aborted before each read
        if (!isMountedRef.current || abortController.signal.aborted) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        // Check again after async read
        if (!isMountedRef.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'text_delta') {
                if (!isMountedRef.current) break;
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastMessage = updated[updated.length - 1];
                  if (lastMessage.role === 'assistant') {
                    lastMessage.content += data.content;
                  }
                  return updated;
                });
              } else if (data.type === 'tool_call') {
                if (!isMountedRef.current) break;
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastMessage = updated[updated.length - 1];
                  if (lastMessage.role === 'assistant') {
                    const toolCall: ToolCallWithMeta = {
                      id: data.id,
                      name: data.name,
                      input: data.input as Record<string, unknown>,
                      startedAt: Date.now(),
                    };
                    lastMessage.toolCalls = [...(lastMessage.toolCalls || []), toolCall];
                  }
                  return updated;
                });
              } else if (data.type === 'tool_result') {
                if (!isMountedRef.current) break;
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastMessage = updated[updated.length - 1];
                  if (lastMessage.role === 'assistant' && lastMessage.toolCalls) {
                    const callIndex = lastMessage.toolCalls.findIndex((c) => c.id === data.id);
                    if (callIndex >= 0) {
                      lastMessage.toolCalls[callIndex] = {
                        ...lastMessage.toolCalls[callIndex],
                        result: {
                          toolCallId: data.id,
                          content: data.output,
                          isError: data.isError,
                        },
                      };
                    }
                  }
                  return updated;
                });
              } else if (data.type === 'message_complete') {
                // Message complete - streaming is done for this message
                // Nothing special to do here since finally block handles setIsStreaming(false)
              } else if (data.type === 'error') {
                if (!isMountedRef.current) break;
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
      // Ignore abort errors (expected when unmounting or starting new request)
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      if (!isMountedRef.current) return;
      setMessages((prev) => {
        const updated = [...prev];
        const lastMessage = updated[updated.length - 1];
        if (lastMessage.role === 'assistant') {
          lastMessage.content = 'Failed to connect to the server';
        }
        return updated;
      });
    } finally {
      if (isMountedRef.current) {
        setIsStreaming(false);
      }
      // Clear the ref if this was our controller
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
    }
  };

  const handleNewSession = () => {
    // Clear current session and messages
    setSessionId(null);
    setMessages([]);
    setLoadError('');
    // Navigate to /chat without session param
    router.replace('/chat');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Page Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">Chat</h1>
        <div className="flex items-center gap-2">
          {settingsLoaded && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {settings.model.split('-').slice(0, 2).join(' ')} | T: {settings.temperature}
            </span>
          )}
          <ChatSettingsButton onClick={() => setSettingsOpen(true)} />
          <Button variant="outline" size="sm" onClick={handleNewSession}>
            New Session
          </Button>
        </div>
      </div>

      {/* Settings Drawer */}
      <ChatSettingsDrawer
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={updateSettings}
        onReset={resetSettings}
      />

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
              <h2 className="text-xl font-semibold text-foreground">Start a conversation</h2>
              <p className="mt-2 text-muted-foreground">Send a message to begin chatting with your assistant</p>
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
                    : 'bg-muted text-foreground'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content || (message.toolCalls?.length ? '' : '...')}</p>
                {message.toolCalls?.map((call) => (
                  <ToolCallCard key={call.id} call={call} result={call.result} />
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-4xl mx-auto">
          <Input
            id="chat-message-input"
            aria-label="Chat message"
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

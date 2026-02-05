'use client';

import { useEffect, useRef, useCallback } from 'react';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { ProcessingIndicator } from './ProcessingIndicator';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';
import { useAuth } from '@/hooks/use-auth';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ChatContainer() {
  const { messages, sessionId, isStreaming } = useChatStore();
  const { accessToken } = useAuth();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = useRef(messages.length);
  const isNearBottomRef = useRef(true);

  // Check if scroll is near bottom (within 100px)
  const checkIfNearBottom = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return true;

    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]');
    if (!viewport) return true;

    const { scrollTop, scrollHeight, clientHeight } = viewport;
    return scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  // Scroll to bottom smoothly
  const scrollToBottom = useCallback((smooth = true) => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]');
    if (!viewport) return;

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  // Track scroll position to determine if user has scrolled up
  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]');
    if (!viewport) return;

    const handleScroll = () => {
      isNearBottomRef.current = checkIfNearBottom();
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [checkIfNearBottom]);

  // Auto-scroll when new messages arrive, but only if user was near bottom
  useEffect(() => {
    const hasNewMessages = messages.length > prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;

    if (hasNewMessages && isNearBottomRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        scrollToBottom(true);
      });
    }
  }, [messages.length, scrollToBottom]);

  // Also scroll when streaming (content updates)
  useEffect(() => {
    if (isStreaming && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom(false); // No animation during streaming for smoother experience
      });
    }
  }, [isStreaming, scrollToBottom]);

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
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
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

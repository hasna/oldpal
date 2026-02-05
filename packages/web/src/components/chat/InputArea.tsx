'use client';

import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/textarea';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';
import { now, generateId } from '@hasna/assistants-shared';

// Default paste threshold configuration (can be overridden via props)
const DEFAULT_PASTE_THRESHOLDS = {
  chars: 500,
  words: 100,
  lines: 20,
};

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countLines(text: string): number {
  return text.split('\n').length;
}

function formatPastePlaceholder(text: string): string {
  const chars = text.length;
  const words = countWords(text);
  return `📋 Pasted ${words.toLocaleString()} words / ${chars.toLocaleString()} chars`;
}

interface PasteThresholds {
  chars?: number;
  words?: number;
  lines?: number;
}

interface PasteConfig {
  /** Whether large paste handling is enabled (default: true) */
  enabled?: boolean;
  /** Paste detection thresholds */
  thresholds?: PasteThresholds;
  /** Display mode: 'placeholder' (default), 'preview', 'confirm', 'inline' */
  mode?: 'placeholder' | 'preview' | 'confirm' | 'inline';
}

function isLargePaste(text: string, thresholds: PasteThresholds = DEFAULT_PASTE_THRESHOLDS): boolean {
  const charThreshold = thresholds.chars ?? DEFAULT_PASTE_THRESHOLDS.chars;
  const wordThreshold = thresholds.words ?? DEFAULT_PASTE_THRESHOLDS.words;
  const lineThreshold = thresholds.lines ?? DEFAULT_PASTE_THRESHOLDS.lines;

  return (
    text.length > charThreshold ||
    countWords(text) > wordThreshold ||
    countLines(text) > lineThreshold
  );
}

interface InputAreaProps {
  /** Optional paste handling configuration */
  pasteConfig?: PasteConfig;
}

export function InputArea({ pasteConfig }: InputAreaProps = {}) {
  const [value, setValue] = useState('');
  const [largePaste, setLargePaste] = useState<{
    content: string;
    placeholder: string;
  } | null>(null);
  const previousValueRef = useRef('');
  const { addMessage, setStreaming, sessionId, createSession, isStreaming, finalizeToolCalls, clearToolCalls } = useChatStore();

  // Paste handling configuration with defaults
  const pasteEnabled = pasteConfig?.enabled !== false;
  const pasteThresholds = pasteConfig?.thresholds ?? DEFAULT_PASTE_THRESHOLDS;
  const pasteMode = pasteConfig?.mode ?? 'placeholder';

  const sendMessage = () => {
    // Prevent concurrent sends while streaming to avoid corrupting tool-call state
    if (isStreaming) return;

    // Use large paste content if available, otherwise use regular value
    const actualContent = largePaste ? largePaste.content : value;
    const trimmed = actualContent.trim();
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
    setLargePaste(null);
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    const previousValue = previousValueRef.current;

    // Detect paste: multiple characters added at once
    const addedChars = newValue.length - previousValue.length;
    const isPaste = addedChars > 1;

    // Only apply special handling if paste handling is enabled and mode is not 'inline'
    if (pasteEnabled && pasteMode !== 'inline' && isPaste && isLargePaste(newValue, pasteThresholds)) {
      // Store the large paste content and show placeholder
      setLargePaste({
        content: newValue,
        placeholder: formatPastePlaceholder(newValue),
      });
      setValue(''); // Clear the visible input
    } else {
      // Normal typing or small paste - clear any pending large paste
      if (largePaste) {
        setLargePaste(null);
      }
      setValue(newValue);
    }

    previousValueRef.current = newValue;
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // First priority: cancel pending large paste
        if (largePaste) {
          setLargePaste(null);
          previousValueRef.current = '';
          return;
        }
        // Second priority: cancel streaming
        if (isStreaming && sessionId) {
          chatWs.send({ type: 'cancel', sessionId });
          // Clean up tool call state since server may not send completion
          finalizeToolCalls();
          clearToolCalls();
          setStreaming(false);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isStreaming, sessionId, setStreaming, finalizeToolCalls, clearToolCalls, largePaste]);

  const hasContent = largePaste ? true : value.trim().length > 0;

  return (
    <div className="flex items-end gap-3 border-t border-border bg-background px-6 py-4" data-tour="chat-input">
      <div className="flex-1">
        {largePaste ? (
          /* Large paste indicator - focusable for keyboard handling */
          <div
            tabIndex={0}
            role="textbox"
            aria-label="Large paste ready to send"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            className="flex items-center gap-2 min-h-[44px] px-3 py-2 border border-input rounded-md bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <span className="text-sm text-yellow-600 dark:text-yellow-400">{largePaste.placeholder}</span>
            <span className="text-xs text-muted-foreground">[Enter to send, Esc to cancel]</span>
          </div>
        ) : (
          <Textarea
            id="chat-input"
            aria-label="Message input"
            placeholder="Ask Assistants anything..."
            value={value}
            onChange={handleChange}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            className="min-h-[44px] max-h-[200px] resize-none"
            rows={1}
          />
        )}
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
      <Button onClick={sendMessage} disabled={isStreaming || !hasContent}>
        {isStreaming ? 'Streaming...' : 'Send'}
      </Button>
    </div>
  );
}

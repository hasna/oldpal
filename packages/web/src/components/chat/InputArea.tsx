'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/textarea';
import { useChatStore } from '@/lib/store';
import { chatWs } from '@/lib/ws';
import { now, generateId } from '@hasna/assistants-shared';
import { useToast } from '@/hooks/use-toast';

type ShellResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
};

async function runShellCommand(command: string, sessionId?: string | null): Promise<ShellResult> {
  const response = await fetch('/api/v1/shell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, sessionId: sessionId || undefined }),
  });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload?.success) {
    const message = payload?.error?.message || response.statusText || 'Shell command failed';
    throw new Error(message);
  }
  return payload.data as ShellResult;
}

function formatShellResult(command: string, result: ShellResult): string {
  const sections: string[] = [
    'Local shell command executed:',
    '```bash\n$ ' + command + '\n```',
    `Exit code: ${result.exitCode ?? 'unknown'}`,
  ];

  if (result.stdout) {
    sections.push('STDOUT:\n```\n' + result.stdout + '\n```');
  } else {
    sections.push('STDOUT: (empty)');
  }

  if (result.stderr) {
    sections.push('STDERR:\n```\n' + result.stderr + '\n```');
  }

  if (result.truncated) {
    sections.push('_Output truncated after 64KB._');
  }

  return sections.join('\n\n');
}

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
  const recognitionRef = useRef<any>(null);
  const listenStateRef = useRef({
    active: false,
    buffer: '',
    interim: '',
    lastTranscriptAt: 0,
  });
  const listenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isListening, setIsListening] = useState(false);
  const isStreamingRef = useRef(isStreaming);
  const {
    addMessage,
    setStreaming,
    sessionId,
    createSession,
    isStreaming,
    finalizeToolCalls,
    clearToolCalls,
    setListening,
    setListeningDraft,
  } = useChatStore();
  const { toast } = useToast();

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Paste handling configuration with defaults
  const pasteEnabled = pasteConfig?.enabled !== false;
  const pasteThresholds = pasteConfig?.thresholds ?? DEFAULT_PASTE_THRESHOLDS;
  const pasteMode = pasteConfig?.mode ?? 'placeholder';

  const sendPayload = useCallback((payload: string) => {
    const effectiveSessionId = sessionId ?? createSession();

    const userMessage = {
      id: generateId(),
      role: 'user' as const,
      content: payload,
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
    chatWs.send({ type: 'message', content: payload, sessionId: effectiveSessionId, messageId: assistantId });
  }, [addMessage, setStreaming, sessionId, createSession]);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    if (isListening) {
      if (newValue.trim().startsWith('/listen')) {
        setValue(newValue);
        previousValueRef.current = newValue;
      }
      return;
    }
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
        if (listenStateRef.current.active) {
          stopListening();
          return;
        }
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

  const appendTranscript = useCallback((base: string, chunk: string) => {
    const trimmed = chunk.trim();
    if (!trimmed) return base;
    if (!base) return trimmed;
    const lastChar = base[base.length - 1] || '';
    const needsSpace = lastChar !== ' ' && !/[.,!?;:]/.test(trimmed[0] || '');
    return `${base}${needsSpace ? ' ' : ''}${trimmed}`;
  }, []);

  const updateDraftFromListening = useCallback(() => {
    const buffer = listenStateRef.current.buffer;
    const interim = listenStateRef.current.interim;
    if (!interim) {
      setValue(buffer);
      previousValueRef.current = buffer;
      setListeningDraft(buffer);
      return;
    }
    const prefix = buffer && !buffer.endsWith(' ') ? ' ' : '';
    const nextValue = `${buffer}${prefix}${interim}`.trimStart();
    setValue(nextValue);
    previousValueRef.current = nextValue;
    setListeningDraft(nextValue);
  }, [setListeningDraft]);

  const stopListening = useCallback(() => {
    if (!listenStateRef.current.active && !recognitionRef.current) return;
    listenStateRef.current.active = false;
    listenStateRef.current.buffer = '';
    listenStateRef.current.interim = '';
    listenStateRef.current.lastTranscriptAt = 0;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors
      }
    }
    recognitionRef.current = null;
    if (listenTimerRef.current) {
      clearInterval(listenTimerRef.current);
      listenTimerRef.current = null;
    }
    setIsListening(false);
    setListening(false);
    setListeningDraft('');
  }, [setListening, setListeningDraft]);

  const startListening = useCallback((initialBuffer?: string) => {
    if (listenStateRef.current.active) return;

    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      toast({
        variant: 'destructive',
        title: 'Speech recognition not supported',
        description: 'Your browser does not support live dictation.',
      });
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    listenStateRef.current.active = true;
    const baseBuffer = initialBuffer ?? (largePaste?.content || value);
    listenStateRef.current.buffer = baseBuffer;
    listenStateRef.current.interim = '';
    listenStateRef.current.lastTranscriptAt = Date.now();
    updateDraftFromListening();
    setLargePaste(null);
    setListening(true);

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }

      if (finalText.trim()) {
        listenStateRef.current.buffer = appendTranscript(listenStateRef.current.buffer, finalText);
        listenStateRef.current.interim = '';
        listenStateRef.current.lastTranscriptAt = Date.now();
      } else if (interim.trim()) {
        listenStateRef.current.interim = interim.trim();
        listenStateRef.current.lastTranscriptAt = Date.now();
      }

      updateDraftFromListening();
    };

    recognition.onerror = (event: any) => {
      const message = event?.error ? `Speech error: ${event.error}` : 'Speech recognition error';
      toast({
        variant: 'destructive',
        title: 'Dictation error',
        description: message,
      });
      stopListening();
    };

    recognition.onend = () => {
      if (!listenStateRef.current.active) return;
      try {
        recognition.start();
      } catch {
        stopListening();
      }
    };

    recognitionRef.current = recognition;
    setIsListening(true);

    try {
      recognition.start();
    } catch {
      stopListening();
      return;
    }

    if (listenTimerRef.current) {
      clearInterval(listenTimerRef.current);
    }
    listenTimerRef.current = setInterval(() => {
      if (!listenStateRef.current.active) return;
      if (isStreamingRef.current) return;
      const nowTime = Date.now();
      const lastAt = listenStateRef.current.lastTranscriptAt;
      const silenceMs = nowTime - lastAt;
      if (silenceMs < 3500) return;
      const buffer = listenStateRef.current.buffer;
      const interim = listenStateRef.current.interim;
      const payload = appendTranscript(buffer, interim).trim();
      if (!payload) return;
      listenStateRef.current.buffer = '';
      listenStateRef.current.interim = '';
      setListeningDraft('');
      updateDraftFromListening();
      sendPayload(payload);
    }, 500);
  }, [appendTranscript, isStreaming, largePaste, sendPayload, stopListening, toast, updateDraftFromListening, value, setListening, setListeningDraft]);

  useEffect(() => () => {
    stopListening();
  }, [stopListening]);

  const sendMessage = useCallback(async () => {
    // Prevent concurrent sends while streaming to avoid corrupting tool-call state
    if (isStreaming) return;

    // Use large paste content if available, otherwise use regular value
    const actualContent = largePaste ? largePaste.content : value;
    const trimmed = actualContent.trim();
    if (!trimmed) return;

    // Check for /listen command (persistent dictation mode)
    if (trimmed.startsWith('/listen')) {
      const arg = trimmed.slice(7).trim().toLowerCase();
      if (arg === 'stop' || arg === 'off') {
        stopListening();
        setValue('');
        setLargePaste(null);
        return;
      }
      if (listenStateRef.current.active) {
        stopListening();
      } else {
        startListening('');
      }
      setValue('');
      setLargePaste(null);
      return;
    }

    // Shell passthrough: !<command> runs locally and reports output to the assistant
    if (trimmed.startsWith('!')) {
      const raw = trimmed.slice(1).trim();
      const shellCommand = raw.startsWith('[') && raw.endsWith(']')
        ? raw.slice(1, -1).trim()
        : raw;
      if (!shellCommand) {
        toast({
          variant: 'destructive',
          title: 'Missing shell command',
          description: 'Usage: !<command>',
        });
        return;
      }

      setValue('');
      setLargePaste(null);

      try {
        const result = await runShellCommand(shellCommand, sessionId);
        const payload = formatShellResult(shellCommand, result);
        sendPayload(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast({
          variant: 'destructive',
          title: 'Shell command failed',
          description: message,
        });
        const fallbackPayload = formatShellResult(shellCommand, {
          ok: false,
          stdout: '',
          stderr: message,
          exitCode: null,
          truncated: false,
        });
        sendPayload(fallbackPayload);
      }
      return;
    }

    sendPayload(trimmed);
    setValue('');
    setLargePaste(null);
  }, [isStreaming, largePaste, value, sendPayload, toast, sessionId, startListening, stopListening]);

  const hasContent = largePaste ? true : value.trim().length > 0;
  const quickCommands = [
    isListening ? '/listen stop' : '/listen',
    '!<command>',
  ];
  const listenHints = isListening
    ? ['listening...', 'pause 3s to send', '[Esc] stop']
    : [];
  const quickHints = [...quickCommands, ...listenHints];

  return (
    <div className="border-t border-border bg-background px-6 py-4" data-tour="chat-input">
      <div className="flex items-end gap-3">
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
      {quickHints.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {quickHints.map((hint) => (
            <span key={hint} className="rounded-full border border-border px-2 py-0.5">
              {hint}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

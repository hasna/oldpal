'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { HeartPulse, Mic } from 'lucide-react';
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

type TranscriptionResult = {
  text: string;
  confidence?: number;
  language?: string;
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

async function transcribeAudio(blob: Blob, language?: string): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.append('file', blob, 'audio.wav');
  if (language) {
    formData.append('language', language);
  }
  const response = await fetch('/api/v1/voice/transcribe', {
    method: 'POST',
    body: formData,
  });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload?.success) {
    const message = payload?.error?.message || response.statusText || 'Transcription failed';
    throw new Error(message);
  }
  return payload.data as TranscriptionResult;
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

function mergeSamples(chunks: Float32Array[], totalLength: number): Float32Array {
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function trimSilence(samples: Float32Array, threshold = 0.01): Float32Array | null {
  let start = 0;
  let end = samples.length - 1;
  while (start < samples.length && Math.abs(samples[start]) < threshold) {
    start += 1;
  }
  while (end > start && Math.abs(samples[end]) < threshold) {
    end -= 1;
  }
  if (start >= end) return null;
  return samples.subarray(start, end + 1);
}

function writeWavString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeWavString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeWavString(view, 8, 'WAVE');
  writeWavString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeWavString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
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
  const liveValueRef = useRef('');
  const listenStateRef = useRef({
    active: false,
    buffer: '',
    interim: '',
    lastTranscriptAt: 0,
    lastTranscriptText: '',
    pendingSend: false,
  });
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingSamplesRef = useRef<Float32Array[]>([]);
  const pendingSampleCountRef = useRef(0);
  const sampleRateRef = useRef(16000);
  const transcribeQueueRef = useRef<Array<{ buffer: ArrayBuffer; kind: 'partial' | 'final'; runId: number }>>([]);
  const transcribeInFlightRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const listenRunIdRef = useRef(0);
  const [isListening, setIsListening] = useState(false);
  const pendingQueueRef = useRef<Array<{ payload: string; assistantId: string; sessionId: string }>>([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const prevSessionIdRef = useRef<string | null>(null);
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
  const isStreamingRef = useRef(isStreaming);
  const { toast } = useToast();

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Paste handling configuration with defaults
  const pasteEnabled = pasteConfig?.enabled !== false;
  const pasteThresholds = pasteConfig?.thresholds ?? DEFAULT_PASTE_THRESHOLDS;
  const pasteMode = pasteConfig?.mode ?? 'placeholder';

  const sendPayload = useCallback((payload: string, options?: { queueIfBusy?: boolean }) => {
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

    const shouldQueue = (options?.queueIfBusy ?? true) && isStreamingRef.current;
    if (shouldQueue) {
      pendingQueueRef.current.push({ payload, assistantId, sessionId: effectiveSessionId });
      setQueuedCount(pendingQueueRef.current.length);
      return;
    }

    setStreaming(true);
    isStreamingRef.current = true;
    chatWs.send({ type: 'message', content: payload, sessionId: effectiveSessionId, messageId: assistantId });
  }, [addMessage, setStreaming, sessionId, createSession]);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    if (isListening) {
      if (newValue.trim().startsWith('/listen')) {
        setValue(newValue);
        previousValueRef.current = newValue;
        liveValueRef.current = newValue;
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
      liveValueRef.current = '';
    } else {
      // Normal typing or small paste - clear any pending large paste
      if (largePaste) {
        setLargePaste(null);
      }
      setValue(newValue);
      liveValueRef.current = newValue;
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
    setValue(buffer);
    liveValueRef.current = buffer;
    previousValueRef.current = buffer;
    setListeningDraft(buffer);
  }, [setListeningDraft]);

  const maybeSendBufferedMessage = useCallback(() => {
    if (!listenStateRef.current.pendingSend) return;
    if (transcribeInFlightRef.current || transcribeQueueRef.current.length > 0) return;
    listenStateRef.current.pendingSend = false;
    const payload = listenStateRef.current.buffer.trim();
    listenStateRef.current.buffer = '';
    listenStateRef.current.interim = '';
    listenStateRef.current.lastTranscriptAt = 0;
    setListeningDraft('');
    updateDraftFromListening();
    if (payload) {
      sendPayload(payload);
    }
  }, [sendPayload, setListeningDraft, updateDraftFromListening]);

  const processTranscriptionQueue = useCallback(async () => {
    if (transcribeInFlightRef.current) return;
    const next = transcribeQueueRef.current.shift();
    if (!next) {
      maybeSendBufferedMessage();
      return;
    }
    if (next.runId !== listenRunIdRef.current) {
      void processTranscriptionQueue();
      return;
    }
    transcribeInFlightRef.current = true;
    try {
      const blob = new Blob([next.buffer], { type: 'audio/wav' });
      const language = typeof navigator !== 'undefined'
        ? (navigator.language || 'en-US').split('-')[0]
        : undefined;
      const result = await transcribeAudio(blob, language);
      if (!listenStateRef.current.active || next.runId !== listenRunIdRef.current) return;
      const text = result.text?.trim();
      if (text) {
        const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
        const nowTime = Date.now();
        const silenceGap = nowTime - lastSpeechAtRef.current;
        const isDuplicate =
          normalized.length > 0 &&
          normalized === listenStateRef.current.lastTranscriptText &&
          nowTime - listenStateRef.current.lastTranscriptAt < 1500;
        const fillerSet = new Set(['thank you', 'thanks', 'thankyou', 'um', 'uh', 'hmm']);
        const isFiller = fillerSet.has(normalized);

        if (!isDuplicate && !(isFiller && silenceGap > 2000)) {
          listenStateRef.current.buffer = appendTranscript(listenStateRef.current.buffer, text);
          updateDraftFromListening();
        }

        listenStateRef.current.lastTranscriptAt = nowTime;
        listenStateRef.current.lastTranscriptText = normalized;
      }
    } catch (error) {
      if (listenStateRef.current.active && next.runId === listenRunIdRef.current) {
        const message = error instanceof Error ? error.message : String(error);
        toast({
          variant: 'destructive',
          title: 'Transcription error',
          description: message,
        });
      }
    } finally {
      transcribeInFlightRef.current = false;
      if (transcribeQueueRef.current.length > 0) {
        void processTranscriptionQueue();
      } else {
        maybeSendBufferedMessage();
      }
    }
  }, [appendTranscript, maybeSendBufferedMessage, toast, updateDraftFromListening]);

  const enqueueTranscription = useCallback((buffer: ArrayBuffer, kind: 'partial' | 'final') => {
    transcribeQueueRef.current.push({ buffer, kind, runId: listenRunIdRef.current });
    void processTranscriptionQueue();
  }, [processTranscriptionQueue]);

  const flushAudioChunk = useCallback((kind: 'partial' | 'final') => {
    if (pendingSampleCountRef.current === 0) {
      if (kind === 'final') {
        maybeSendBufferedMessage();
      }
      return;
    }
    const merged = mergeSamples(pendingSamplesRef.current, pendingSampleCountRef.current);
    pendingSamplesRef.current = [];
    pendingSampleCountRef.current = 0;
    const trimmed = trimSilence(merged);
    if (!trimmed) {
      if (kind === 'final') {
        maybeSendBufferedMessage();
      }
      return;
    }
    const wavBuffer = encodeWav(trimmed, sampleRateRef.current);
    enqueueTranscription(wavBuffer, kind);
  }, [enqueueTranscription, maybeSendBufferedMessage]);

  const stopListening = useCallback(() => {
    if (!listenStateRef.current.active && !mediaStreamRef.current) return;
    listenRunIdRef.current += 1;
    listenStateRef.current.active = false;
    listenStateRef.current.pendingSend = false;
    listenStateRef.current.buffer = '';
    listenStateRef.current.interim = '';
    listenStateRef.current.lastTranscriptAt = 0;
    listenStateRef.current.lastTranscriptText = '';
    lastSpeechAtRef.current = 0;
    pendingSamplesRef.current = [];
    pendingSampleCountRef.current = 0;
    transcribeQueueRef.current = [];
    transcribeInFlightRef.current = false;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    setIsListening(false);
    setListening(false);
    setListeningDraft('');
  }, [setListening, setListeningDraft]);

  useEffect(() => {
    if (prevSessionIdRef.current && prevSessionIdRef.current !== sessionId) {
      // Clear queued sends when switching sessions to avoid cross-session leakage.
      pendingQueueRef.current = [];
      setQueuedCount(0);
      if (listenStateRef.current.active) {
        stopListening();
      }
      setLargePaste(null);
    }
    prevSessionIdRef.current = sessionId ?? null;
  }, [sessionId, stopListening]);

  const startListening = useCallback(async (initialBuffer?: string) => {
    if (listenStateRef.current.active) return;
    if (!navigator?.mediaDevices?.getUserMedia) {
      toast({
        variant: 'destructive',
        title: 'Microphone unavailable',
        description: 'Your browser does not support microphone access.',
      });
      return;
    }

    listenRunIdRef.current += 1;
    listenStateRef.current.active = true;
    listenStateRef.current.pendingSend = false;
    const baseBuffer = initialBuffer ?? (largePaste?.content || value);
    listenStateRef.current.buffer = baseBuffer;
    listenStateRef.current.interim = '';
    listenStateRef.current.lastTranscriptAt = Date.now();
    listenStateRef.current.lastTranscriptText = '';
    updateDraftFromListening();
    setLargePaste(null);
    setListening(true);
    setIsListening(true);
    lastSpeechAtRef.current = Date.now();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      sampleRateRef.current = audioContext.sampleRate;
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const gain = audioContext.createGain();
      gain.gain.value = 0;

      source.connect(processor);
      processor.connect(gain);
      gain.connect(audioContext.destination);

      processor.onaudioprocess = (event) => {
        if (!listenStateRef.current.active) return;
        const input = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < input.length; i += 1) {
          const value = input[i];
          sum += value * value;
        }
        const rms = Math.sqrt(sum / input.length);
        const nowTime = Date.now();
        const threshold = 0.01;
        if (rms > threshold) {
          lastSpeechAtRef.current = nowTime;
        }
        if (rms > threshold || nowTime - lastSpeechAtRef.current < 500) {
          const chunk = new Float32Array(input.length);
          chunk.set(input);
          pendingSamplesRef.current.push(chunk);
          pendingSampleCountRef.current += chunk.length;
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({
        variant: 'destructive',
        title: 'Microphone error',
        description: message,
      });
      stopListening();
      return;
    }

    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
    }
    chunkTimerRef.current = setInterval(() => {
      if (!listenStateRef.current.active) return;
      const minSamples = sampleRateRef.current * 1.2;
      if (pendingSampleCountRef.current >= minSamples) {
        flushAudioChunk('partial');
      }
    }, 1200);

    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
    }
    silenceTimerRef.current = setInterval(() => {
      if (!listenStateRef.current.active) return;
      if (listenStateRef.current.pendingSend) return;
      const nowTime = Date.now();
      const silenceMs = nowTime - lastSpeechAtRef.current;
      if (silenceMs < 3500) return;
      listenStateRef.current.pendingSend = true;
      flushAudioChunk('final');
      if (pendingSampleCountRef.current === 0) {
        maybeSendBufferedMessage();
      }
    }, 500);
  }, [
    flushAudioChunk,
    largePaste,
    maybeSendBufferedMessage,
    stopListening,
    toast,
    updateDraftFromListening,
    value,
    setListening,
  ]);

  useEffect(() => () => {
    stopListening();
  }, [stopListening]);

  const flushQueued = useCallback(() => {
    if (isStreamingRef.current) return;
    const next = pendingQueueRef.current.shift();
    if (!next) {
      setQueuedCount(0);
      return;
    }
    setQueuedCount(pendingQueueRef.current.length);
    setStreaming(true);
    isStreamingRef.current = true;
    chatWs.send({ type: 'message', content: next.payload, sessionId: next.sessionId, messageId: next.assistantId });
  }, []);

  useEffect(() => {
    if (!isStreaming && pendingQueueRef.current.length > 0) {
      flushQueued();
    }
  }, [isStreaming, flushQueued]);

  const sendMessage = useCallback(async (overrideValue?: string) => {
    // Use large paste content if available, otherwise use regular value
    const actualContent = overrideValue ?? (largePaste ? largePaste.content : (liveValueRef.current || value));
    const trimmed = actualContent.trim();
    if (!trimmed) return;

    // Check for /listen command (persistent dictation mode)
    if (trimmed.startsWith('/listen')) {
      const arg = trimmed.slice(7).trim().toLowerCase();
      if (arg === 'stop' || arg === 'off') {
        stopListening();
        setValue('');
        liveValueRef.current = '';
        setLargePaste(null);
        return;
      }
      if (listenStateRef.current.active) {
        stopListening();
      } else {
        startListening('');
      }
      setValue('');
      liveValueRef.current = '';
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
      liveValueRef.current = '';
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
    liveValueRef.current = '';
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
  const queueHint = queuedCount > 0 ? `queued ${queuedCount}` : '';
  const quickHints = [...quickCommands, ...listenHints, ...(queueHint ? [queueHint] : [])];
  const showStatusRow = quickHints.length > 0 || isListening;

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
                  sendMessage((event.currentTarget as HTMLInputElement).value || '');
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
        <Button onClick={() => sendMessage()} disabled={!hasContent}>
          {isStreaming ? 'Queue' : 'Send'}
        </Button>
      </div>
      {showStatusRow && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-3.5 w-3.5 text-rose-500" />
            {isListening && (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <Mic className="h-3 w-3" />
                live
              </span>
            )}
          </div>
          {quickHints.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {quickHints.map((hint) => (
                <span key={hint} className="rounded-full border border-border px-2 py-0.5">
                  {hint}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

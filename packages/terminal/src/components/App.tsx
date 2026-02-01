import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { SessionRegistry, type SessionInfo } from '@hasna/assistants-core';
import type { StreamChunk, Message, ToolCall, ToolResult, TokenUsage, EnergyState, VoiceState, ActiveIdentityInfo } from '@hasna/assistants-shared';
import { generateId, now } from '@hasna/assistants-shared';
import { Input } from './Input';
import { Messages } from './Messages';
import { Status } from './Status';
import { Spinner } from './Spinner';
import { ProcessingIndicator } from './ProcessingIndicator';
import { WelcomeBanner } from './WelcomeBanner';
import { SessionSelector } from './SessionSelector';

const SHOW_ERROR_CODES = process.env.ASSISTANTS_DEBUG === '1' || process.env.OLDPAL_DEBUG === '1';

// Format tool name for compact display
function formatToolName(toolCall: ToolCall): string {
  const { name, input } = toolCall;
  switch (name) {
    case 'bash':
      return `bash`;
    case 'read':
      const path = String(input.path || input.file_path || '');
      return `read ${path.split('/').pop() || ''}`;
    case 'write':
      const writePath = String(input.filename || input.path || input.file_path || '');
      return `write ${writePath.split('/').pop() || ''}`;
    case 'glob':
      return `glob`;
    case 'grep':
      return `grep`;
    case 'web_search':
      return `search`;
    case 'web_fetch':
    case 'curl':
      return `fetch`;
    default:
      return name;
  }
}

function parseErrorMessage(error: string): { code?: string; message: string; suggestion?: string } {
  const lines = error.split('\n');
  const suggestionLine = lines.find((line) => line.toLowerCase().startsWith('suggestion:'));
  const suggestion = suggestionLine ? suggestionLine.replace(/^suggestion:\s*/i, '').trim() : undefined;
  const mainLines = suggestionLine ? lines.filter((line) => line !== suggestionLine) : lines;
  let message = mainLines.join('\n').trim();
  let code: string | undefined;
  const index = message.indexOf(':');
  if (index > 0) {
    const candidate = message.slice(0, index).trim();
    if (/^[A-Z0-9_]+$/.test(candidate)) {
      code = candidate;
      message = message.slice(index + 1).trim();
    }
  }
  return { code, message, suggestion };
}

interface AppProps {
  cwd: string;
  version?: string;
}

// Activity entry for tracking tool calls and text during a turn
interface ActivityEntry {
  id: string;
  type: 'text' | 'tool_call' | 'tool_result';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  timestamp: number;
}

// Per-session UI state
interface SessionUIState {
  messages: Message[];
  currentResponse: string;
  activityLog: ActivityEntry[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  tokenUsage: TokenUsage | undefined;
  energyState: EnergyState | undefined;
  voiceState: VoiceState | undefined;
  identityInfo: ActiveIdentityInfo | undefined;
  processingStartTime: number | undefined;
  currentTurnTokens: number;
  error: string | null;
}

interface QueuedMessage {
  id: string;
  sessionId: string;
  content: string;
  queuedAt: number;
}

const MESSAGE_CHUNK_LINES = 12;
const MESSAGE_WRAP_CHARS = 120;

function buildDisplayMessages(messages: Message[], chunkLines: number, wrapChars: number): Message[] {
  const display: Message[] = [];

  for (const msg of messages) {
    const content = msg.content ?? '';
    const shouldChunk = content.trim() !== '';
    if (!shouldChunk) {
      display.push(msg);
      continue;
    }

    const rawLines = content.split('\n');
    const lines: string[] = [];
    for (const line of rawLines) {
      if (line.length <= wrapChars) {
        lines.push(line);
        continue;
      }
      for (let i = 0; i < line.length; i += wrapChars) {
        lines.push(line.slice(i, i + wrapChars));
      }
    }
    if (lines.length <= chunkLines) {
      display.push(msg);
      continue;
    }

    const totalChunks = Math.ceil(lines.length / chunkLines);
    for (let i = 0; i < totalChunks; i++) {
      const chunkContent = lines.slice(i * chunkLines, (i + 1) * chunkLines).join('\n');
      display.push({
        ...msg,
        id: `${msg.id}::chunk-${i}`,
        content: chunkContent,
        toolCalls: i === totalChunks - 1 ? msg.toolCalls : undefined,
        toolResults: i === totalChunks - 1 ? msg.toolResults : undefined,
      });
    }
  }

  return display;
}

export function App({ cwd, version }: AppProps) {
  const { exit } = useApp();
  const { rows, columns } = useStdout();

  // Session registry
  const [registry] = useState(() => new SessionRegistry());
  const registryRef = useRef(registry);

  // Active session state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [showSessionSelector, setShowSessionSelector] = useState(false);

  // Per-session UI state stored by session ID
  const sessionUIStates = useRef<Map<string, SessionUIState>>(new Map());

  // Current session UI state (derived from active session)
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentResponse, setCurrentResponse] = useState('');
  const [currentToolCall, setCurrentToolCall] = useState<ToolCall | undefined>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | undefined>();
  const [energyState, setEnergyState] = useState<EnergyState | undefined>();
  const [voiceState, setVoiceState] = useState<VoiceState | undefined>();
  const [identityInfo, setIdentityInfo] = useState<ActiveIdentityInfo | undefined>();
  const [processingStartTime, setProcessingStartTime] = useState<number | undefined>();
  const [currentTurnTokens, setCurrentTurnTokens] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);

  // Available skills for autocomplete
  const [skills, setSkills] = useState<{ name: string; description: string; argumentHint?: string }[]>([]);

  // Use ref to track response for the done callback
  const responseRef = useRef('');
  const toolCallsRef = useRef<ToolCall[]>([]);
  const toolResultsRef = useRef<ToolResult[]>([]);
  const activityLogRef = useRef<ActivityEntry[]>([]);
  const prevDisplayCountRef = useRef(0);
  const skipNextDoneRef = useRef(false);
  const isProcessingRef = useRef(isProcessing);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    if (isProcessing && !processingStartTime) {
      setProcessingStartTime(Date.now());
    }
  }, [isProcessing, processingStartTime]);

  const buildFullResponse = useCallback(() => {
    const parts = activityLogRef.current
      .filter((entry) => entry.type === 'text' && entry.content)
      .map((entry) => entry.content as string);

    if (responseRef.current.trim()) {
      parts.push(responseRef.current);
    }

    return parts.join('\n').trim();
  }, []);

  const finalizeResponse = useCallback((status?: 'stopped' | 'interrupted' | 'error') => {
    const baseContent = buildFullResponse();
    const hasContent = baseContent.length > 0;
    const activityToolCalls = activityLogRef.current
      .filter((entry) => entry.type === 'tool_call' && entry.toolCall)
      .map((entry) => entry.toolCall as ToolCall);
    const activityToolResults = activityLogRef.current
      .filter((entry) => entry.type === 'tool_result' && entry.toolResult)
      .map((entry) => entry.toolResult as ToolResult);

    const toolCallMap = new Map<string, ToolCall>();
    for (const toolCall of activityToolCalls) {
      toolCallMap.set(toolCall.id, toolCall);
    }
    for (const toolCall of toolCallsRef.current) {
      toolCallMap.set(toolCall.id, toolCall);
    }
    const mergedToolCalls = Array.from(toolCallMap.values());

    const toolResultMap = new Map<string, ToolResult>();
    for (const toolResult of activityToolResults) {
      toolResultMap.set(toolResult.toolCallId, toolResult);
    }
    for (const toolResult of toolResultsRef.current) {
      toolResultMap.set(toolResult.toolCallId, toolResult);
    }
    const mergedToolResults = Array.from(toolResultMap.values());

    const hasTools = mergedToolCalls.length > 0;

    if (!hasContent && !hasTools) {
      return false;
    }

    let content = baseContent;
    if (status === 'stopped') {
      content = content ? `${content}\n\n[stopped]` : '[stopped]';
    } else if (status === 'interrupted') {
      content = content ? `${content}\n\n[interrupted]` : '[interrupted]';
    } else if (status === 'error') {
      content = content ? `${content}\n\n[error]` : '[error]';
    }

    setMessages((prev) => [
      ...prev,
      {
        id: generateId(),
        role: 'assistant',
        content,
        timestamp: now(),
        toolCalls: hasTools ? mergedToolCalls : undefined,
        toolResults: mergedToolResults.length > 0 ? mergedToolResults : undefined,
      },
    ]);

    return true;
  }, [buildFullResponse]);

  const resetTurnState = useCallback(() => {
    setCurrentResponse('');
    responseRef.current = '';
    toolCallsRef.current = [];
    toolResultsRef.current = [];
    setCurrentToolCall(undefined);
    setActivityLog([]);
    activityLogRef.current = [];
    setProcessingStartTime(undefined);
    setCurrentTurnTokens(0);
  }, []);

  // Save current session UI state
  const saveCurrentSessionState = useCallback(() => {
    if (activeSessionId) {
      sessionUIStates.current.set(activeSessionId, {
        messages,
        currentResponse: responseRef.current,
        activityLog: activityLogRef.current,
        toolCalls: toolCallsRef.current,
        toolResults: toolResultsRef.current,
        tokenUsage,
        energyState,
        voiceState,
        identityInfo,
        processingStartTime,
        currentTurnTokens,
        error,
      });
    }
  }, [activeSessionId, messages, tokenUsage, energyState, voiceState, identityInfo, processingStartTime, currentTurnTokens, error]);

  // Load session UI state
  const loadSessionState = useCallback((sessionId: string) => {
    const state = sessionUIStates.current.get(sessionId);
    if (state) {
      setMessages(state.messages);
      setCurrentResponse(state.currentResponse);
      responseRef.current = state.currentResponse;
      setActivityLog(state.activityLog);
      activityLogRef.current = state.activityLog;
      toolCallsRef.current = state.toolCalls;
      toolResultsRef.current = state.toolResults;
      setCurrentToolCall(undefined);
      setTokenUsage(state.tokenUsage);
      setEnergyState(state.energyState);
      setVoiceState(state.voiceState);
      setIdentityInfo(state.identityInfo);
      setProcessingStartTime(state.processingStartTime);
      setCurrentTurnTokens(state.currentTurnTokens);
      setError(state.error);
    } else {
      // New session - reset state
      setMessages([]);
      setCurrentResponse('');
      responseRef.current = '';
      setActivityLog([]);
      activityLogRef.current = [];
      toolCallsRef.current = [];
      toolResultsRef.current = [];
      setCurrentToolCall(undefined);
      setTokenUsage(undefined);
      setEnergyState(undefined);
      setVoiceState(undefined);
      setIdentityInfo(undefined);
      setProcessingStartTime(undefined);
      setCurrentTurnTokens(0);
      setError(null);
    }
    setScrollOffset(0);
    setAutoScroll(true);
  }, []);

  // Handle chunk from registry
  const handleChunk = useCallback((chunk: StreamChunk) => {
    if (chunk.type === 'text' && chunk.content) {
      responseRef.current += chunk.content;
      setCurrentResponse(responseRef.current);
    } else if (chunk.type === 'tool_use' && chunk.toolCall) {
      // Save any accumulated text before the tool call
      if (responseRef.current.trim()) {
        const textEntry = {
          id: generateId(),
          type: 'text' as const,
          content: responseRef.current,
          timestamp: now(),
        };
        activityLogRef.current = [...activityLogRef.current, textEntry];
        setActivityLog(activityLogRef.current);
        setCurrentResponse('');
        responseRef.current = '';
      }

      // Track tool call
      toolCallsRef.current.push(chunk.toolCall);
      const toolEntry = {
        id: generateId(),
        type: 'tool_call' as const,
        toolCall: chunk.toolCall,
        timestamp: now(),
      };
      activityLogRef.current = [...activityLogRef.current, toolEntry];
      setActivityLog(activityLogRef.current);
      setCurrentToolCall(chunk.toolCall);
    } else if (chunk.type === 'tool_result' && chunk.toolResult) {
      if (!isProcessingRef.current) {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== 'assistant') return prev;
          const existing = last.toolResults || [];
          if (existing.some((r) => r.toolCallId === chunk.toolResult!.toolCallId)) {
            return prev;
          }
          const updated: Message = {
            ...last,
            toolResults: [...existing, chunk.toolResult!],
          };
          return [...prev.slice(0, -1), updated];
        });
        return;
      }
      // Track tool result
      toolResultsRef.current.push(chunk.toolResult);
      const resultEntry = {
        id: generateId(),
        type: 'tool_result' as const,
        toolResult: chunk.toolResult,
        timestamp: now(),
      };
      activityLogRef.current = [...activityLogRef.current, resultEntry];
      setActivityLog(activityLogRef.current);
      setCurrentToolCall(undefined);
    } else if (chunk.type === 'error' && chunk.error) {
      const finalized = finalizeResponse('error');
      if (finalized) {
        skipNextDoneRef.current = true;
      }
      resetTurnState();
      setError(chunk.error);
      setIsProcessing(false);
      isProcessingRef.current = false;
    } else if (chunk.type === 'exit') {
      // Exit command was issued
      registry.closeAll();
      exit();
    } else if (chunk.type === 'usage' && chunk.usage) {
      setTokenUsage(chunk.usage);
      // Track tokens for current turn
      setCurrentTurnTokens((prev) => prev + (chunk.usage?.outputTokens || 0));
    } else if (chunk.type === 'done') {
      const shouldSkip = skipNextDoneRef.current;
      skipNextDoneRef.current = false;
      if (!shouldSkip) {
        finalizeResponse();
      }
      setIsProcessing(false);
      isProcessingRef.current = false;
      // Defer clearing streaming state to avoid flicker where output disappears
      queueMicrotask(() => {
        resetTurnState();
      });

      // Update token usage from client
      const activeSession = registry.getActiveSession();
      if (activeSession) {
        setTokenUsage(activeSession.client.getTokenUsage());
        setEnergyState(activeSession.client.getEnergyState() ?? undefined);
        setVoiceState(activeSession.client.getVoiceState() ?? undefined);
        setIdentityInfo(activeSession.client.getIdentityInfo() ?? undefined);
      }
    }
  }, [registry, exit, finalizeResponse, resetTurnState]);

  // Initialize first session
  useEffect(() => {
    const initSession = async () => {
      try {
        // Register chunk handler
        registry.onChunk(handleChunk);
        registry.onError((err) => {
          const finalized = finalizeResponse('error');
          if (finalized) {
            skipNextDoneRef.current = true;
          }
          resetTurnState();
          setError(err.message);
          setIsProcessing(false);
          isProcessingRef.current = false;
          const active = registryRef.current.getActiveSession();
          if (active) {
            registryRef.current.setProcessing(active.id, false);
          }
        });

        // Create first session
        const session = await registry.createSession(cwd);
        setActiveSessionId(session.id);

        // Load available skills for autocomplete
        const loadedSkills = await session.client.getSkills();
        setSkills(loadedSkills.map(s => ({
          name: s.name,
          description: s.description || '',
          argumentHint: s.argumentHint,
        })));
        setEnergyState(session.client.getEnergyState() ?? undefined);
        setVoiceState(session.client.getVoiceState() ?? undefined);
        setIdentityInfo(session.client.getIdentityInfo() ?? undefined);

        setIsInitializing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsInitializing(false);
      }
    };

    initSession();

    // Cleanup on unmount
    return () => {
      registry.closeAll();
    };
  }, [cwd, registry, handleChunk, finalizeResponse, resetTurnState]);

  // Process queued messages
  const processQueue = useCallback(async () => {
    const activeSession = registryRef.current.getActiveSession();
    if (!activeSession || !activeSessionId) return;

    let nextMessage: QueuedMessage | undefined;
    setMessageQueue((prev) => {
      const idx = prev.findIndex((msg) => msg.sessionId === activeSessionId);
      if (idx === -1) {
        return prev;
      }
      nextMessage = prev[idx];
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });

    if (!nextMessage) return;

    // Add user message if not already shown (queued messages are pre-rendered)
    const userMessage: Message = {
      id: nextMessage.id,
      role: 'user',
      content: nextMessage.content,
      timestamp: nextMessage.queuedAt,
    };
    setMessages((prev) => {
      if (prev.some((msg) => msg.id === userMessage.id)) {
        return prev;
      }
      return [...prev, userMessage];
    });

    // Reset state
    skipNextDoneRef.current = false;
    setCurrentResponse('');
    responseRef.current = '';
    toolCallsRef.current = [];
    toolResultsRef.current = [];
    setError(null);
    setCurrentToolCall(undefined);
    setActivityLog([]);
    activityLogRef.current = [];
    setProcessingStartTime(Date.now());
    setCurrentTurnTokens(0);
    setIsProcessing(true);
    isProcessingRef.current = true;

    registryRef.current.setProcessing(activeSession.id, true);
    await activeSession.client.send(nextMessage.content);
  }, [activeSessionId]);

  const activeQueue = activeSessionId
    ? messageQueue.filter((msg) => msg.sessionId === activeSessionId)
    : [];
  const queuedMessageIds = useMemo(
    () => new Set(activeQueue.map((msg) => msg.id)),
    [activeQueue]
  );

  const wrapChars = columns ? Math.max(40, columns - 4) : MESSAGE_WRAP_CHARS;
  const displayMessages = useMemo(
    () => buildDisplayMessages(messages, MESSAGE_CHUNK_LINES, wrapChars),
    [messages, wrapChars]
  );
  const streamingMessages = useMemo(() => {
    if (!isProcessing || !currentResponse.trim()) return [];
    const streamingMessage: Message = {
      id: 'streaming-response',
      role: 'assistant',
      content: currentResponse,
      timestamp: now(),
    };
    return buildDisplayMessages([streamingMessage], MESSAGE_CHUNK_LINES, wrapChars);
  }, [currentResponse, isProcessing, wrapChars]);
  const displayCount = displayMessages.length + streamingMessages.length;

  // Process queue when not processing
  useEffect(() => {
    if (!isProcessing && activeQueue.length > 0) {
      processQueue();
    }
  }, [isProcessing, activeQueue.length, processQueue]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll) {
      setScrollOffset(0);
    }
  }, [displayCount, autoScroll]);

  // Keep viewport stable when not auto-scrolling
  useEffect(() => {
    const prevCount = prevDisplayCountRef.current;
    if (!autoScroll && displayCount > prevCount) {
      const delta = displayCount - prevCount;
      setScrollOffset((prev) => prev + delta);
    }
    prevDisplayCountRef.current = displayCount;
  }, [displayCount, autoScroll]);

  // Max visible messages - size to terminal height when available
  const reservedLines = 8;
  const baseMaxVisible = rows ? Math.max(3, rows - reservedLines) : 10;
  const toolCallsHeight = isProcessing ? Math.min(toolCallsRef.current.length, 5) : 0;
  const maxVisibleMessages = Math.max(3, baseMaxVisible - toolCallsHeight);

  // Clamp scroll offset to available range
  useEffect(() => {
    const maxOffset = Math.max(0, displayCount - maxVisibleMessages);
    setScrollOffset((prev) => Math.min(prev, maxOffset));
  }, [displayCount, maxVisibleMessages]);

  // Get session info
  const sessions = registry.listSessions();
  const activeSession = registry.getActiveSession();
  const sessionIndex = activeSessionId ? registry.getSessionIndex(activeSessionId) : 0;
  const sessionCount = registry.getSessionCount();
  const backgroundProcessingCount = registry.getBackgroundProcessingSessions().length;

  // Handle session switch
  const handleSessionSwitch = useCallback(async (sessionId: string) => {
    // Close selector IMMEDIATELY
    setShowSessionSelector(false);

    if (sessionId === activeSessionId) {
      return;
    }

    // Save current session state first
    saveCurrentSessionState();

    // Load new session state BEFORE switching (prevents race with buffered chunk replay)
    loadSessionState(sessionId);

    // Update processing state from new session
    const session = registry.getSession(sessionId);
    if (session) {
      setIsProcessing(session.isProcessing);
      isProcessingRef.current = session.isProcessing;
      setEnergyState(session.client.getEnergyState() ?? undefined);
      setVoiceState(session.client.getVoiceState() ?? undefined);
      setIdentityInfo(session.client.getIdentityInfo() ?? undefined);
    }

    // Now switch session in registry (may replay buffered chunks to the reset state)
    await registry.switchSession(sessionId);
    setActiveSessionId(sessionId);
  }, [activeSessionId, registry, saveCurrentSessionState, loadSessionState]);

  // Handle new session creation
  const handleNewSession = useCallback(async () => {
    // Close selector IMMEDIATELY - don't wait for async operations
    setShowSessionSelector(false);

    try {
      // Save current session state
      saveCurrentSessionState();

      // Create new session
      const newSession = await registry.createSession(cwd);

      // Now switch to new session
      await registry.switchSession(newSession.id);
      setActiveSessionId(newSession.id);

      // Initialize empty state AFTER switching (prevents old-session chunks from repopulating UI)
      loadSessionState(newSession.id);
      setIsProcessing(false);
      isProcessingRef.current = false;
      setEnergyState(newSession.client.getEnergyState() ?? undefined);
      setVoiceState(newSession.client.getVoiceState() ?? undefined);
      setIdentityInfo(newSession.client.getIdentityInfo() ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  }, [cwd, registry, saveCurrentSessionState, loadSessionState]);

  // Handle keyboard shortcuts (inactive when session selector is shown)
  useInput((input, key) => {
    // Ctrl+S: show session selector
    if (key.ctrl && input === 's') {
      if (sessions.length > 0) {
        setShowSessionSelector(true);
      }
      return;
    }

    // Ctrl+C: stop or exit
    if (key.ctrl && input === 'c') {
      if (isProcessing && activeSession) {
        activeSession.client.stop();
        const finalized = finalizeResponse('stopped');
        if (finalized) {
          skipNextDoneRef.current = true;
        }
        resetTurnState();
        registryRef.current.setProcessing(activeSession.id, false);
        setIsProcessing(false);
        isProcessingRef.current = false;
      } else {
        registry.closeAll();
        exit();
      }
    }
    // Escape: stop processing or close session selector
    if (key.escape) {
      if (isProcessing && activeSession) {
        activeSession.client.stop();
        const finalized = finalizeResponse('stopped');
        if (finalized) {
          skipNextDoneRef.current = true;
        }
        resetTurnState();
        registryRef.current.setProcessing(activeSession.id, false);
        setIsProcessing(false);
        isProcessingRef.current = false;
      }
    }

    // Page Up: scroll up through messages
    if (key.pageUp || (key.shift && key.upArrow)) {
      setScrollOffset((prev) => {
        const maxOffset = Math.max(0, displayCount - maxVisibleMessages);
        const newOffset = Math.min(prev + 3, maxOffset);
        if (newOffset > 0) setAutoScroll(false);
        return newOffset;
      });
    }

    // Page Down: scroll down through messages
    if (key.pageDown || (key.shift && key.downArrow)) {
      setScrollOffset((prev) => {
        const newOffset = Math.max(0, prev - 3);
        if (newOffset === 0) setAutoScroll(true);
        return newOffset;
      });
    }

    // Home: scroll to top
    if (key.ctrl && input === 'u') {
      const maxOffset = Math.max(0, displayCount - maxVisibleMessages);
      setScrollOffset(maxOffset);
      setAutoScroll(false);
    }

    // End: scroll to bottom
    if (key.ctrl && input === 'd') {
      setScrollOffset(0);
      setAutoScroll(true);
    }
  }, { isActive: !showSessionSelector });

  // Handle message submission
  const handleSubmit = useCallback(
    async (input: string, mode: 'normal' | 'interrupt' | 'queue' = 'normal') => {
      if (!activeSession || !input.trim()) return;

      const trimmedInput = input.trim();

      // Check for $skill command - convert to /skill format
      if (trimmedInput.startsWith('$')) {
        const skillInput = '/' + trimmedInput.slice(1);
        // Continue with the converted input
        return handleSubmit(skillInput, mode);
      }

      // Check for /session command
      if (trimmedInput.startsWith('/session')) {
        const arg = trimmedInput.slice(8).trim();

        if (arg === 'new') {
          await handleNewSession();
          return;
        }

        const num = parseInt(arg, 10);
        if (!isNaN(num) && num > 0 && num <= sessions.length) {
          await handleSessionSwitch(sessions[num - 1].id);
          return;
        }

        // No arg or invalid - show session list
        setShowSessionSelector(true);
        return;
      }

      // Queue mode: add to queue for later
      if (mode === 'queue' || (isProcessing && mode === 'normal')) {
        if (!activeSessionId) return;
        const queuedId = generateId();
        setMessageQueue((prev) => [
          ...prev,
          { id: queuedId, sessionId: activeSessionId, content: trimmedInput, queuedAt: now() },
        ]);
        setMessages((prev) => [
          ...prev,
          {
            id: queuedId,
            role: 'user',
            content: trimmedInput,
            timestamp: now(),
          },
        ]);
        return;
      }

      // Interrupt mode: stop current and send immediately
      if (mode === 'interrupt' && isProcessing) {
        activeSession.client.stop();
        // Save partial response
        const finalized = finalizeResponse('interrupted');
        if (finalized) {
          skipNextDoneRef.current = true;
        }
        resetTurnState();
        setIsProcessing(false);
        isProcessingRef.current = false;
        registry.setProcessing(activeSession.id, false);
        // Small delay to ensure stop is processed
        await new Promise((r) => setTimeout(r, 100));
      }

      // Add user message
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: trimmedInput,
        timestamp: now(),
      };
      setMessages((prev) => {
        if (prev.some((msg) => msg.id === userMessage.id)) {
          return prev;
        }
        return [...prev, userMessage];
      });

      // Reset state
      skipNextDoneRef.current = false;
      setCurrentResponse('');
      responseRef.current = '';
      toolCallsRef.current = [];
      toolResultsRef.current = [];
      setError(null);
      setCurrentToolCall(undefined);
      setActivityLog([]);
      activityLogRef.current = [];
      setProcessingStartTime(Date.now());
      setCurrentTurnTokens(0);
      setIsProcessing(true);
      isProcessingRef.current = true;

      // Mark session as processing
      registry.setProcessing(activeSession.id, true);

      // Send to agent
      await activeSession.client.send(trimmedInput);
    },
    [
      activeSession,
      isProcessing,
      registry,
      sessions,
      handleNewSession,
      handleSessionSwitch,
      finalizeResponse,
      resetTurnState,
      activeSessionId,
    ]
  );

  if (isInitializing) {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Initializing..." />
      </Box>
    );
  }

  // Show session selector modal
  if (showSessionSelector) {
    return (
      <Box flexDirection="column" padding={1}>
        <SessionSelector
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSessionSwitch}
          onNew={handleNewSession}
          onCancel={() => setShowSessionSelector(false)}
        />
      </Box>
    );
  }

  // Build tool call entries for the box
  const toolCallEntries = activityLog
    .filter((e) => e.type === 'tool_call' && e.toolCall)
    .map((e) => {
      const result = activityLog.find(
        (r) => r.type === 'tool_result' && r.toolResult?.toolCallId === e.toolCall?.id
      )?.toolResult;
      return { toolCall: e.toolCall!, result };
    });

  // Check if currently thinking (no response and no tool calls yet)
  const isThinking = isProcessing && !currentResponse && !currentToolCall && toolCallEntries.length === 0;

  const MAX_QUEUED_PREVIEW = 3;
  const truncateQueued = (text: string, maxLen: number = 80) => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + '...';
  };

  // Show welcome banner only when no messages
  const showWelcome = messages.length === 0 && !isProcessing;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Welcome banner */}
      {showWelcome && (
        <WelcomeBanner
          version={version ?? '0.6.13'}
          model="claude-sonnet-4"
          directory={activeSession?.cwd || cwd}
        />
      )}

      {/* Background processing indicator */}
      {backgroundProcessingCount > 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">
            {backgroundProcessingCount} session{backgroundProcessingCount > 1 ? 's' : ''} processing in background (Ctrl+S to switch)
          </Text>
        </Box>
      )}

      {/* Scroll indicator */}
      {scrollOffset > 0 && (
        <Box>
          <Text dimColor>↑ {scrollOffset} more messages above (Shift+↓ or Page Down to scroll down)</Text>
        </Box>
      )}

      {/* Messages - key forces remount on session switch for clean state */}
      <Messages
        key={activeSessionId || 'default'}
        messages={displayMessages}
        currentResponse={undefined}
        streamingMessages={streamingMessages}
        currentToolCall={undefined}
        lastToolResult={undefined}
        activityLog={isProcessing ? activityLog : []}
        queuedMessageIds={queuedMessageIds}
        scrollOffset={scrollOffset}
        maxVisible={maxVisibleMessages}
      />

      {/* Tool calls - show last 3 tool calls inline during processing */}
      {isProcessing && toolCallEntries.length > 0 && (
        <Box marginY={1} flexDirection="column">
          {toolCallEntries.slice(-3).map(({ toolCall, result }) => (
            <Box key={toolCall.id}>
              <Text dimColor>
                {result ? '✓' : '⚙'} {formatToolName(toolCall)}
                {result?.isError && <Text color="red"> (error)</Text>}
              </Text>
            </Box>
          ))}
          {toolCallEntries.length > 3 && (
            <Text dimColor>  ... and {toolCallEntries.length - 3} more tools</Text>
          )}
        </Box>
      )}

      {/* Queue indicator */}
      {activeQueue.length > 0 && (
        <Box marginY={1} flexDirection="column">
          <Text dimColor>
            {activeQueue.length} message{activeQueue.length > 1 ? 's' : ''} queued
          </Text>
          {activeQueue.slice(0, MAX_QUEUED_PREVIEW).map((queued) => (
            <Box key={queued.id} marginLeft={2}>
              <Text dimColor>❯ {truncateQueued(queued.content)}</Text>
            </Box>
          ))}
          {activeQueue.length > MAX_QUEUED_PREVIEW && (
            <Text dimColor>  ... and {activeQueue.length - MAX_QUEUED_PREVIEW} more</Text>
          )}
        </Box>
      )}

      {/* Error */}
      {error && (() => {
        const parsed = parseErrorMessage(error);
        const severity = parsed.code && /TIMEOUT|RATE_LIMITED/.test(parsed.code) ? 'yellow' : 'red';
        const prefix = SHOW_ERROR_CODES && parsed.code ? `${parsed.code}: ` : '';
        return (
          <Box marginY={1} flexDirection="column">
            <Text color={severity}>{prefix}{parsed.message}</Text>
            {parsed.suggestion && (
              <Text color={severity}>Suggestion: {parsed.suggestion}</Text>
            )}
          </Box>
        );
      })()}

      {/* Processing indicator */}
      <ProcessingIndicator
        isProcessing={isProcessing}
        startTime={processingStartTime}
        tokenCount={currentTurnTokens}
        isThinking={isThinking}
      />

      {/* Input - always enabled, supports queue/interrupt */}
      <Input
        onSubmit={handleSubmit}
        isProcessing={isProcessing}
        queueLength={activeQueue.length}
        skills={skills}
      />

      {/* Status bar */}
      <Status
        isProcessing={isProcessing}
        cwd={activeSession?.cwd || cwd}
        queueLength={activeQueue.length}
        tokenUsage={tokenUsage}
        energyState={energyState}
        voiceState={voiceState}
        identityInfo={identityInfo}
        sessionIndex={sessionIndex}
        sessionCount={sessionCount}
        backgroundProcessingCount={backgroundProcessingCount}
        sessionId={activeSessionId}
        processingStartTime={processingStartTime}
      />
    </Box>
  );
}

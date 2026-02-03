import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Box, Text, useApp, useInput, useStdout, Static } from 'ink';
import { SessionRegistry, type SessionInfo } from '@hasna/assistants-core';
import type { StreamChunk, Message, ToolCall, ToolResult, TokenUsage, EnergyState, VoiceState, ActiveIdentityInfo, AskUserRequest, AskUserResponse } from '@hasna/assistants-shared';
import { generateId, now } from '@hasna/assistants-shared';
import { Input } from './Input';
import { Messages } from './Messages';
import { buildDisplayMessages } from './messageRender';
import { estimateDisplayMessagesLines, trimActivityLogByLines, trimDisplayMessagesByLines } from './messageLines';
import { Status } from './Status';
import { Spinner } from './Spinner';
import { ProcessingIndicator } from './ProcessingIndicator';
import { WelcomeBanner } from './WelcomeBanner';
import { SessionSelector } from './SessionSelector';
import { ErrorBanner } from './ErrorBanner';
import { QueueIndicator } from './QueueIndicator';
import { AskUserPanel } from './AskUserPanel';
import type { QueuedMessage } from './appTypes';

const SHOW_ERROR_CODES = process.env.ASSISTANTS_DEBUG === '1';

function formatElapsedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
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

interface AskUserState {
  sessionId: string;
  request: AskUserRequest;
  index: number;
  answers: Record<string, string>;
  resolve: (response: AskUserResponse) => void;
  reject: (error: Error) => void;
}

const MESSAGE_CHUNK_LINES = 12;
const MESSAGE_WRAP_CHARS = 120;

export function App({ cwd, version }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 80;

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
  const [inlinePending, setInlinePending] = useState<QueuedMessage[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | undefined>();
  const [energyState, setEnergyState] = useState<EnergyState | undefined>();
  const [voiceState, setVoiceState] = useState<VoiceState | undefined>();
  const [identityInfo, setIdentityInfo] = useState<ActiveIdentityInfo | undefined>();
  const [verboseTools, setVerboseTools] = useState(false);
  const [askUserState, setAskUserState] = useState<AskUserState | null>(null);
  const [processingStartTime, setProcessingStartTime] = useState<number | undefined>();
  const [currentTurnTokens, setCurrentTurnTokens] = useState(0);

  // Available skills for autocomplete
  const [skills, setSkills] = useState<{ name: string; description: string; argumentHint?: string }[]>([]);
  const [commands, setCommands] = useState<{ name: string; description: string }[]>([]);

  // Use ref to track response for the done callback
  const responseRef = useRef('');
  const toolCallsRef = useRef<ToolCall[]>([]);
  const toolResultsRef = useRef<ToolResult[]>([]);
  const activityLogRef = useRef<ActivityEntry[]>([]);
  const skipNextDoneRef = useRef(false);
  const isProcessingRef = useRef(isProcessing);
  const processingStartTimeRef = useRef<number | undefined>(processingStartTime);
  const pendingSendsRef = useRef<Array<{ id: string; sessionId: string; mode: 'inline' | 'queued' }>>([]);
  const askUserStateRef = useRef<Map<string, AskUserState>>(new Map());
  const clearPendingSend = useCallback((id: string, sessionId: string) => {
    pendingSendsRef.current = pendingSendsRef.current.filter(
      (entry) => entry.id !== id || entry.sessionId !== sessionId
    );
    setInlinePending((prev) => prev.filter((msg) => msg.id !== id));
  }, []);

  // Native terminal scrolling is used - no manual scroll tracking needed

  const beginAskUser = useCallback((sessionId: string, request: AskUserRequest) => {
    return new Promise<AskUserResponse>((resolve, reject) => {
      if (askUserStateRef.current.has(sessionId)) {
        reject(new Error('Another interview is already in progress for this session.'));
        return;
      }
      const state: AskUserState = {
        sessionId,
        request,
        index: 0,
        answers: {},
        resolve,
        reject,
      };
      askUserStateRef.current.set(sessionId, state);
      if (sessionId === activeSessionId) {
        setAskUserState(state);
      }
    });
  }, [activeSessionId]);

  const cancelAskUser = useCallback((reason: string, sessionId?: string | null) => {
    const activeId = sessionId ?? activeSessionId;
    if (!activeId) return;
    const current = askUserStateRef.current.get(activeId);
    if (!current) return;
    askUserStateRef.current.delete(activeId);
    if (activeId === activeSessionId) {
      setAskUserState(null);
    }
    current.reject(new Error(reason));
  }, [activeSessionId]);

  const submitAskAnswer = useCallback((answer: string) => {
    setAskUserState((prev) => {
      if (!prev) return prev;
      const question = prev.request.questions[prev.index];
      const answers = { ...prev.answers, [question.id]: answer };
      const nextIndex = prev.index + 1;
      if (nextIndex >= prev.request.questions.length) {
        askUserStateRef.current.delete(prev.sessionId);
        prev.resolve({ answers });
        return null;
      }
      const nextState: AskUserState = {
        ...prev,
        index: nextIndex,
        answers,
      };
      askUserStateRef.current.set(prev.sessionId, nextState);
      return nextState;
    });
  }, []);

  // Terminal resize is handled natively
  const turnIdRef = useRef(0);
  const initStateRef = useRef<'idle' | 'pending' | 'done'>('idle');
  const isMountedRef = useRef(true);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    processingStartTimeRef.current = processingStartTime;
  }, [processingStartTime]);

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

  const loadSessionMetadata = useCallback(async (session: SessionInfo) => {
    try {
      const [loadedSkills, loadedCommands] = await Promise.all([
        session.client.getSkills(),
        session.client.getCommands(),
      ]);
      setSkills(loadedSkills.map((s) => ({
        name: s.name,
        description: s.description || '',
        argumentHint: s.argumentHint,
      })));
      setCommands(loadedCommands.map((cmd) => ({
        name: cmd.name.startsWith('/') ? cmd.name : `/${cmd.name}`,
        description: cmd.description || '',
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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

    if (processingStartTimeRef.current) {
      const workedFor = formatElapsedDuration(Date.now() - processingStartTimeRef.current);
      content = content ? `${content}\n\n✻ Worked for ${workedFor}` : `✻ Worked for ${workedFor}`;
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
  }, [buildFullResponse]); // Note: processingStartTime accessed via ref to avoid dependency chain issues

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
    const askState = askUserStateRef.current.get(sessionId) || null;
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
      setAskUserState(askState);
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
      setAskUserState(askState);
    }
  }, []);

  // Handle chunk from registry
  const handleChunk = useCallback((chunk: StreamChunk) => {
    const isStartChunk = chunk.type === 'text' || chunk.type === 'tool_use';
    const isTerminalChunk = chunk.type === 'error' || chunk.type === 'done';
    if (!isProcessingRef.current && (isStartChunk || isTerminalChunk)) {
      const active = registryRef.current.getActiveSession();
      if (active) {
        turnIdRef.current += 1;
        resetTurnState();
        setError(null);
        registryRef.current.setProcessing(active.id, true);
        setIsProcessing(true);
        isProcessingRef.current = true;
        setProcessingStartTime(Date.now());
        const pendingIndex = pendingSendsRef.current.findIndex((entry) => entry.sessionId === active.id);
        if (pendingIndex !== -1) {
          const [started] = pendingSendsRef.current.splice(pendingIndex, 1);
          if (started?.mode === 'inline') {
            setInlinePending((prev) => prev.filter((msg) => msg.id !== started.id));
          }
        }
      }
    }

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
          const toolCallId = chunk.toolResult!.toolCallId;
          for (let i = prev.length - 1; i >= 0; i -= 1) {
            const msg = prev[i];
            if (msg.role !== 'assistant' || !msg.toolCalls) continue;
            if (!msg.toolCalls.some((call) => call.id === toolCallId)) continue;
            const existing = msg.toolResults || [];
            if (existing.some((r) => r.toolCallId === toolCallId)) {
              return prev;
            }
            const updated: Message = {
              ...msg,
              toolResults: [...existing, chunk.toolResult!],
            };
            return [...prev.slice(0, i), updated, ...prev.slice(i + 1)];
          }
          return prev;
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
      const active = registryRef.current.getActiveSession();
      if (active) {
        registryRef.current.setProcessing(active.id, false);
      }
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
      const active = registryRef.current.getActiveSession();
      if (active) {
        registryRef.current.setProcessing(active.id, false);
      }
      const turnId = turnIdRef.current;
      // Defer clearing streaming state to avoid flicker where output disappears
      queueMicrotask(() => {
        if (!isProcessingRef.current && turnIdRef.current === turnId) {
          resetTurnState();
        }
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
    // Only skip if initialization completed successfully
    // Allow retry if we were interrupted (state is still 'idle' or was reset to 'idle')
    if (initStateRef.current === 'done') return;

    // If already pending, another instance is running
    if (initStateRef.current === 'pending') return;

    initStateRef.current = 'pending';

    let cancelled = false;

    const initSession = async () => {
      try {
        // Register chunk handler (only once)
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

        // Once session is created, always complete initialization
        // Even if cleanup was called, the session is ready to use
        // This prevents the "Initializing..." hang when cleanup races with creation

        setActiveSessionId(session.id);
        session.client.setAskUserHandler((request) => beginAskUser(session.id, request));

        await loadSessionMetadata(session);

        setEnergyState(session.client.getEnergyState() ?? undefined);
        setVoiceState(session.client.getVoiceState() ?? undefined);
        setIdentityInfo(session.client.getIdentityInfo() ?? undefined);

        initStateRef.current = 'done';
        setIsInitializing(false);
      } catch (err) {
        initStateRef.current = 'idle'; // Allow retry on error
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsInitializing(false);
      }
    };

    initSession();

    // Cleanup - only set cancelled flag, don't close registry
    // Registry cleanup happens in the mount/unmount effect below
    return () => {
      cancelled = true;
    };
  }, [cwd, registry, handleChunk, finalizeResponse, resetTurnState, loadSessionMetadata, beginAskUser]);

  // Separate effect for component mount/unmount lifecycle
  // This ensures registry is only closed when component truly unmounts
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      registry.closeAll();
    };
  }, [registry]);

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

    pendingSendsRef.current.push({
      id: nextMessage.id,
      sessionId: activeSessionId,
      mode: 'queued',
    });

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
    try {
      await activeSession.client.send(nextMessage.content);
    } catch (err) {
      clearPendingSend(nextMessage.id, activeSessionId);
      setError(err instanceof Error ? err.message : String(err));
      setIsProcessing(false);
      isProcessingRef.current = false;
      registryRef.current.setProcessing(activeSession.id, false);
    }
  }, [activeSessionId, clearPendingSend]);

  const activeQueue = activeSessionId
    ? messageQueue.filter((msg) => msg.sessionId === activeSessionId)
    : [];
  const activeInline = activeSessionId
    ? inlinePending.filter((msg) => msg.sessionId === activeSessionId)
    : [];
  const queuedMessageIds = useMemo(
    () => new Set(activeQueue.filter((msg) => msg.mode === 'queued').map((msg) => msg.id)),
    [activeQueue]
  );

  // Get session info
  const sessions = registry.listSessions();
  const activeSession = registry.getActiveSession();
  const sessionIndex = activeSessionId ? registry.getSessionIndex(activeSessionId) : 0;
  const sessionCount = registry.getSessionCount();
  const backgroundProcessingCount = registry.getBackgroundProcessingSessions().length;

  const MAX_QUEUED_PREVIEW = 3;
  const inlineCount = activeInline.length;
  const activeAskQuestion = askUserState && askUserState.sessionId === activeSessionId
    ? askUserState.request.questions[askUserState.index]
    : undefined;
  const askPlaceholder = activeAskQuestion?.placeholder || activeAskQuestion?.question || 'Answer the question...';
  const hasPendingTools = useMemo(() => {
    const toolResultIds = new Set<string>();
    for (const entry of activityLog) {
      if (entry.type === 'tool_result' && entry.toolResult) {
        toolResultIds.add(entry.toolResult.toolCallId);
      }
    }
    for (const entry of activityLog) {
      if (entry.type === 'tool_call' && entry.toolCall) {
        if (!toolResultIds.has(entry.toolCall.id)) {
          return true;
        }
      }
    }
    return false;
  }, [activityLog]);
  const isBusy = isProcessing || hasPendingTools;

  // Show welcome banner only when no messages
  const showWelcome = messages.length === 0 && !isProcessing;

  const renderWidth = columns ? Math.max(1, columns - 2) : undefined;
  const wrapChars = renderWidth ?? MESSAGE_WRAP_CHARS;

  const displayMessages = useMemo(
    () => buildDisplayMessages(messages, MESSAGE_CHUNK_LINES, wrapChars, { maxWidth: renderWidth }),
    [messages, wrapChars, renderWidth]
  );

  const reservedLines = 12;
  const dynamicBudget = Math.max(6, rows - reservedLines);

  const streamingTrim = useMemo(() => {
    if (!isProcessing || !currentResponse.trim()) {
      return { messages: [], trimmed: false };
    }
    const streamingMessage: Message = {
      id: 'streaming-response',
      role: 'assistant',
      content: currentResponse,
      timestamp: now(),
    };
    const display = buildDisplayMessages([streamingMessage], MESSAGE_CHUNK_LINES, wrapChars, { maxWidth: renderWidth });
    return trimDisplayMessagesByLines(display, dynamicBudget, renderWidth);
  }, [currentResponse, isProcessing, wrapChars, renderWidth, dynamicBudget]);
  const streamingMessages = streamingTrim.messages;
  const streamingTrimmed = streamingTrim.trimmed;
  const streamingLineCount = useMemo(
    () => estimateDisplayMessagesLines(streamingMessages, renderWidth),
    [streamingMessages, renderWidth]
  );
  const activityTrim = useMemo(() => {
    const activityBudget = Math.max(4, dynamicBudget - streamingLineCount);
    return trimActivityLogByLines(activityLog, wrapChars, renderWidth, activityBudget);
  }, [activityLog, wrapChars, renderWidth, dynamicBudget, streamingLineCount]);

  // Process queue when not processing
  useEffect(() => {
    if (!isProcessing && activeQueue.length > 0 && activeInline.length === 0) {
      processQueue();
    }
  }, [isProcessing, activeQueue.length, activeInline.length, processQueue]);

  // Native terminal scrolling handles scroll position automatically

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
      await loadSessionMetadata(session);
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
      newSession.client.setAskUserHandler((request) => beginAskUser(newSession.id, request));

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
      await loadSessionMetadata(newSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  }, [cwd, registry, saveCurrentSessionState, loadSessionState, beginAskUser]);


  // Handle keyboard shortcuts (inactive when session selector is shown)
  useInput((input, key) => {
    // Ctrl+S: show session selector
    if (key.ctrl && input === 's') {
      if (sessions.length > 0) {
        setShowSessionSelector(true);
      }
      return;
    }

    // Ctrl+C: stop processing (input handles clearing when idle)
    if (key.ctrl && input === 'c') {
      const hasAsk = activeSessionId ? askUserStateRef.current.has(activeSessionId) : false;
      if (hasAsk) {
        cancelAskUser('Cancelled by user', activeSessionId);
      }
      if ((isProcessing || hasPendingTools) && activeSession) {
        activeSession.client.stop();
        const finalized = finalizeResponse('stopped');
        if (finalized) {
          skipNextDoneRef.current = true;
        }
        resetTurnState();
        registryRef.current.setProcessing(activeSession.id, false);
        setIsProcessing(false);
        isProcessingRef.current = false;
        return;
      }
      if (hasAsk) {
        return;
      }
    }
    // Ctrl+O: toggle full tool output
    if (key.ctrl && input === 'o') {
      setVerboseTools((prev) => !prev);
      return;
    }
    // Escape: stop processing or close session selector
    if (key.escape) {
      if (activeSessionId && askUserStateRef.current.has(activeSessionId)) {
        cancelAskUser('Cancelled by user', activeSessionId);
      }
      if ((isProcessing || hasPendingTools) && activeSession) {
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

    // Native terminal scrolling is used - scroll with terminal's scrollback
  }, { isActive: !showSessionSelector });


  // Handle message submission
  const handleSubmit = useCallback(
    async (input: string, mode: 'normal' | 'interrupt' | 'queue' | 'inline' = 'normal') => {
      if (activeSessionId && askUserStateRef.current.has(activeSessionId)) {
        submitAskAnswer(input.trim());
        return;
      }
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

      const isClearCommand = trimmedInput === '/clear' || trimmedInput === '/new';

      if (isClearCommand && isProcessing) {
        activeSession.client.stop();
        const finalized = finalizeResponse('interrupted');
        if (finalized) {
          skipNextDoneRef.current = true;
        }
        resetTurnState();
        setIsProcessing(false);
        isProcessingRef.current = false;
        registry.setProcessing(activeSession.id, false);
        await new Promise((r) => setTimeout(r, 100));
      }

      // Queue mode: add to queue for later
      if (mode === 'queue') {
        if (!activeSessionId) return;
        const queuedId = generateId();
        setMessageQueue((prev) => [
          ...prev,
          {
            id: queuedId,
            sessionId: activeSessionId,
            content: trimmedInput,
            queuedAt: now(),
            mode: 'queued',
          },
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

      // Inline mode: send immediately (client will queue while processing)
      if (mode === 'inline') {
        if (!activeSessionId) return;
        const inlineId = generateId();
        setInlinePending((prev) => [
          ...prev,
          {
            id: inlineId,
            sessionId: activeSessionId,
            content: trimmedInput,
            queuedAt: now(),
            mode: 'inline',
          },
        ]);
        setMessages((prev) => [
          ...prev,
          {
            id: inlineId,
            role: 'user',
            content: trimmedInput,
            timestamp: now(),
          },
        ]);
        pendingSendsRef.current.push({ id: inlineId, sessionId: activeSessionId, mode: 'inline' });
        try {
          await activeSession.client.send(trimmedInput);
        } catch (err) {
          clearPendingSend(inlineId, activeSessionId);
          setError(err instanceof Error ? err.message : String(err));
        }
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

      if (isClearCommand) {
        // Reset UI state for this session before executing clear on the agent.
        setMessages([]);
        setMessageQueue((prev) => prev.filter((msg) => msg.sessionId !== activeSession.id));
        setInlinePending((prev) => prev.filter((msg) => msg.sessionId !== activeSession.id));
        pendingSendsRef.current = pendingSendsRef.current.filter(
          (entry) => entry.sessionId !== activeSession.id
        );
        setActivityLog([]);
        activityLogRef.current = [];
        sessionUIStates.current.set(activeSession.id, {
          messages: [],
          currentResponse: '',
          activityLog: [],
          toolCalls: [],
          toolResults: [],
          tokenUsage,
          energyState,
          voiceState,
          identityInfo,
          processingStartTime: undefined,
          currentTurnTokens: 0,
          error: null,
        });
      } else {
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
      }

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
      try {
        await activeSession.client.send(trimmedInput);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsProcessing(false);
        isProcessingRef.current = false;
        registry.setProcessing(activeSession.id, false);
      }
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
      submitAskAnswer,
      clearPendingSend,
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

  return (
    <Box flexDirection="column" padding={1}>
      {/* Welcome banner */}
      {showWelcome && (
        <WelcomeBanner
          version={version ?? 'unknown'}
          model={activeSession?.client.getModel() ?? 'unknown'}
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

      {/* Historical messages - rendered with Static for native terminal scrollback */}
      <Static items={displayMessages}>
        {(message) => (
          <Messages
            key={message.id}
            messages={[message]}
            currentResponse={undefined}
            streamingMessages={[]}
            currentToolCall={undefined}
            lastToolResult={undefined}
            activityLog={[]}
            queuedMessageIds={queuedMessageIds}
            verboseTools={verboseTools}
          />
        )}
      </Static>

      {/* Current streaming content and activity - rendered dynamically */}
      {isProcessing && (
        <>
          {streamingTrimmed && (
            <Box marginBottom={1}>
              <Text dimColor>⋯ showing latest output</Text>
            </Box>
          )}
          {activityTrim.trimmed && (
            <Box marginBottom={1}>
              <Text dimColor>⋯ showing latest activity</Text>
            </Box>
          )}
          <Messages
            key="streaming"
            messages={[]}
            currentResponse={undefined}
            streamingMessages={streamingMessages}
            currentToolCall={undefined}
            lastToolResult={undefined}
            activityLog={activityTrim.entries}
            queuedMessageIds={queuedMessageIds}
            verboseTools={verboseTools}
          />
        </>
      )}

      {/* Queue indicator */}
      <QueueIndicator
        messages={[...activeInline, ...activeQueue]}
        maxPreview={MAX_QUEUED_PREVIEW}
      />

      {/* Ask-user interview */}
      {askUserState && activeAskQuestion && (
        <AskUserPanel
          sessionId={askUserState.sessionId}
          request={askUserState.request}
          question={activeAskQuestion}
          index={askUserState.index}
          total={askUserState.request.questions.length}
        />
      )}

      {/* Error */}
      {error && <ErrorBanner error={error} showErrorCodes={SHOW_ERROR_CODES} />}

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
        isProcessing={isBusy}
        queueLength={activeQueue.length + inlineCount}
        commands={commands}
        skills={skills}
        isAskingUser={Boolean(activeAskQuestion)}
        askPlaceholder={askPlaceholder}
      />

      {/* Status bar */}
      <Status
        isProcessing={isBusy}
        cwd={activeSession?.cwd || cwd}
        queueLength={activeQueue.length + inlineCount}
        tokenUsage={tokenUsage}
        energyState={energyState}
        voiceState={voiceState}
        identityInfo={identityInfo}
        sessionIndex={sessionIndex}
        sessionCount={sessionCount}
        backgroundProcessingCount={backgroundProcessingCount}
        sessionId={activeSessionId}
        processingStartTime={processingStartTime}
        verboseTools={verboseTools}
      />
    </Box>
  );
}

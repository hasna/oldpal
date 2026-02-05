import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Box, Text, useApp, useInput, useStdout, Static } from 'ink';
import { SessionRegistry, SessionStorage, findRecoverableSessions, clearRecoveryState, ConnectorBridge, type SessionInfo, type RecoverableSession } from '@hasna/assistants-core';
import type { StreamChunk, Message, ToolCall, ToolResult, TokenUsage, EnergyState, VoiceState, HeartbeatState, ActiveIdentityInfo, AskUserRequest, AskUserResponse, Connector, HookConfig, HookEvent, HookHandler, ScheduledCommand } from '@hasna/assistants-shared';
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
import { RecoveryPanel } from './RecoveryPanel';
import { ConnectorsPanel } from './ConnectorsPanel';
import { TasksPanel } from './TasksPanel';
import { AssistantsPanel } from './AssistantsPanel';
import { HooksPanel } from './HooksPanel';
import { ConfigPanel } from './ConfigPanel';
import { MessagesPanel } from './MessagesPanel';
import { GuardrailsPanel } from './GuardrailsPanel';
import { BudgetPanel } from './BudgetPanel';
import { AgentsPanel } from './AgentsPanel';
import { SchedulesPanel } from './SchedulesPanel';
import type { QueuedMessage } from './appTypes';
import {
  getTasks,
  addTask,
  deleteTask,
  clearPendingTasks,
  clearCompletedTasks,
  isPaused,
  setPaused,
  startTask,
  updateTask,
  HookStore,
  nativeHookRegistry,
  loadConfig,
  getConfigDir,
  getProjectConfigDir,
  GuardrailsStore,
  PERMISSIVE_POLICY,
  RESTRICTIVE_POLICY,
  BudgetTracker,
  getGlobalRegistry,
  type Task,
  type TaskPriority,
  type TaskCreateOptions,
  type GuardrailsConfig,
  type PolicyInfo,
  type BudgetScope,
  type BudgetStatus,
  type RegisteredAgent,
  type RegistryStats,
  listSchedules,
  deleteSchedule,
  updateSchedule,
  computeNextRun,
} from '@hasna/assistants-core';
import type { BudgetConfig, BudgetLimits } from '@hasna/assistants-shared';
import type { AssistantsConfig } from '@hasna/assistants-shared';

const SHOW_ERROR_CODES = process.env.ASSISTANTS_DEBUG === '1';

function formatElapsedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  // Show "<1s" for very quick responses (sub-second)
  if (totalSeconds === 0) return '<1s';
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const output = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      output[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      output[key] = sourceValue as T[keyof T];
    }
  }
  return output;
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
  heartbeatState: HeartbeatState | undefined;
  identityInfo: ActiveIdentityInfo | undefined;
  processingStartTime: number | undefined;
  currentTurnTokens: number;
  error: string | null;
  lastWorkedFor: string | undefined;
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

  // Recovery state for crashed sessions
  const [recoverableSessions, setRecoverableSessions] = useState<RecoverableSession[]>([]);
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false);

  // Connectors panel state
  const [showConnectorsPanel, setShowConnectorsPanel] = useState(false);
  const [connectorsPanelInitial, setConnectorsPanelInitial] = useState<string | undefined>();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const connectorBridgeRef = useRef<ConnectorBridge | null>(null);

  // Tasks panel state
  const [showTasksPanel, setShowTasksPanel] = useState(false);
  const [tasksList, setTasksList] = useState<Task[]>([]);
  const [tasksPaused, setTasksPaused] = useState(false);

  // Schedules panel state
  const [showSchedulesPanel, setShowSchedulesPanel] = useState(false);
  const [schedulesList, setSchedulesList] = useState<ScheduledCommand[]>([]);

  // Assistants panel state
  const [showAssistantsPanel, setShowAssistantsPanel] = useState(false);
  const [assistantsRefreshKey, setAssistantsRefreshKey] = useState(0);
  const [assistantError, setAssistantError] = useState<string | null>(null);

  // Hooks panel state
  const [showHooksPanel, setShowHooksPanel] = useState(false);
  const [hooksConfig, setHooksConfig] = useState<HookConfig>({});
  const hookStoreRef = useRef<HookStore | null>(null);

  // Guardrails panel state
  const [showGuardrailsPanel, setShowGuardrailsPanel] = useState(false);
  const [guardrailsConfig, setGuardrailsConfig] = useState<GuardrailsConfig | null>(null);
  const [guardrailsPolicies, setGuardrailsPolicies] = useState<PolicyInfo[]>([]);
  const guardrailsStoreRef = useRef<GuardrailsStore | null>(null);

  // Budget panel state
  const [showBudgetPanel, setShowBudgetPanel] = useState(false);
  const [budgetConfig, setBudgetConfig] = useState<BudgetConfig | null>(null);
  const [sessionBudgetStatus, setSessionBudgetStatus] = useState<BudgetStatus | null>(null);
  const [swarmBudgetStatus, setSwarmBudgetStatus] = useState<BudgetStatus | null>(null);
  const budgetTrackerRef = useRef<BudgetTracker | null>(null);

  // Agents panel state
  const [showAgentsPanel, setShowAgentsPanel] = useState(false);
  const [agentsList, setAgentsList] = useState<RegisteredAgent[]>([]);
  const [registryStats, setRegistryStats] = useState<RegistryStats | null>(null);

  // Config panel state
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<AssistantsConfig | null>(null);
  const [userConfig, setUserConfig] = useState<Partial<AssistantsConfig> | null>(null);
  const [projectConfig, setProjectConfig] = useState<Partial<AssistantsConfig> | null>(null);
  const [localConfig, setLocalConfig] = useState<Partial<AssistantsConfig> | null>(null);

  // Messages panel state
  const [showMessagesPanel, setShowMessagesPanel] = useState(false);
  const [messagesPanelError, setMessagesPanelError] = useState<string | null>(null);
  const [messagesList, setMessagesList] = useState<Array<{
    id: string;
    threadId: string;
    fromAgentId: string;
    fromAgentName: string;
    subject?: string;
    preview: string;
    body?: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    status: 'unread' | 'read' | 'archived' | 'injected';
    createdAt: string;
    replyCount?: number;
  }>>([]);

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
  const [heartbeatState, setHeartbeatState] = useState<HeartbeatState | undefined>();
  const [identityInfo, setIdentityInfo] = useState<ActiveIdentityInfo | undefined>();
  const [verboseTools, setVerboseTools] = useState(false);
  const [askUserState, setAskUserState] = useState<AskUserState | null>(null);
  const [processingStartTime, setProcessingStartTime] = useState<number | undefined>();
  const [currentTurnTokens, setCurrentTurnTokens] = useState(0);
  const [lastWorkedFor, setLastWorkedFor] = useState<string | undefined>();

  // Available skills for autocomplete
  const [skills, setSkills] = useState<{ name: string; description: string; argumentHint?: string }[]>([]);
  const [commands, setCommands] = useState<{ name: string; description: string }[]>([]);

  // Track Ctrl+C for double-tap exit
  const lastCtrlCRef = useRef<number>(0);
  const [showExitHint, setShowExitHint] = useState(false);

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
  // Trigger state update to force queue processing check after processing completes
  const [queueFlushTrigger, setQueueFlushTrigger] = useState(0);
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
  const handlersRegisteredRef = useRef(false);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    processingStartTimeRef.current = processingStartTime;
  }, [processingStartTime]);

  useEffect(() => {
    if (isProcessing && !processingStartTime) {
      const now = Date.now();
      setProcessingStartTime(now);
      processingStartTimeRef.current = now; // Sync ref immediately for synchronous access
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

    // Store worked duration for sticky display above input (instead of appending to each message)
    if (processingStartTimeRef.current) {
      const workedFor = formatElapsedDuration(Date.now() - processingStartTimeRef.current);
      setLastWorkedFor(workedFor);
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
        heartbeatState,
        identityInfo,
        processingStartTime,
        currentTurnTokens,
        error,
        lastWorkedFor,
      });
    }
  }, [activeSessionId, messages, tokenUsage, energyState, voiceState, heartbeatState, identityInfo, processingStartTime, currentTurnTokens, error, lastWorkedFor]);

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
      setHeartbeatState(state.heartbeatState);
      setIdentityInfo(state.identityInfo);
      setProcessingStartTime(state.processingStartTime);
      setCurrentTurnTokens(state.currentTurnTokens);
      setError(state.error);
      setLastWorkedFor(state.lastWorkedFor);
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
      setHeartbeatState(undefined);
      setIdentityInfo(undefined);
      setProcessingStartTime(undefined);
      setCurrentTurnTokens(0);
      setError(null);
      setLastWorkedFor(undefined);
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
        const startNow = Date.now();
        setProcessingStartTime(startNow);
        processingStartTimeRef.current = startNow; // Sync ref immediately for synchronous access
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
      // Trigger queue flush check after state settles
      setQueueFlushTrigger((prev) => prev + 1);
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

      // Trigger queue flush check after state settles
      setQueueFlushTrigger((prev) => prev + 1);

      // Update token usage from client
      const activeSession = registry.getActiveSession();
      if (activeSession) {
        setTokenUsage(activeSession.client.getTokenUsage());
        setEnergyState(activeSession.client.getEnergyState() ?? undefined);
        setVoiceState(activeSession.client.getVoiceState() ?? undefined);
        setHeartbeatState(activeSession.client.getHeartbeatState?.() ?? undefined);
        setIdentityInfo(activeSession.client.getIdentityInfo() ?? undefined);
      }
    } else if (chunk.type === 'show_panel') {
      // Show interactive panel
      if (chunk.panel === 'connectors') {
        setConnectorsPanelInitial(chunk.panelValue);
        setShowConnectorsPanel(true);
      } else if (chunk.panel === 'tasks') {
        // Load tasks and show panel
        getTasks(cwd).then((tasks) => {
          setTasksList(tasks);
          isPaused(cwd).then((paused) => {
            setTasksPaused(paused);
            setShowTasksPanel(true);
          });
        });
      } else if (chunk.panel === 'schedules') {
        // Load schedules and show panel
        listSchedules(cwd).then((schedules) => {
          setSchedulesList(schedules);
          setShowSchedulesPanel(true);
        });
      } else if (chunk.panel === 'assistants') {
        // Show assistants panel
        setShowAssistantsPanel(true);
      } else if (chunk.panel === 'hooks') {
        // Load hooks and show panel
        if (!hookStoreRef.current) {
          hookStoreRef.current = new HookStore(cwd);
        }
        const hooks = hookStoreRef.current.loadAll();
        setHooksConfig(hooks);
        setShowHooksPanel(true);
      } else if (chunk.panel === 'config') {
        // Load config and show panel
        loadConfigFiles();
        setShowConfigPanel(true);
      } else if (chunk.panel === 'messages') {
        // Load messages and show panel
        const messagesManager = registry.getActiveSession()?.client.getMessagesManager?.();
        if (messagesManager) {
          messagesManager.list({ limit: 50 }).then((msgs: Array<{
            id: string;
            threadId: string;
            fromAgentId: string;
            fromAgentName: string;
            subject?: string;
            preview: string;
            body?: string;
            priority: string;
            status: string;
            createdAt: string;
            replyCount?: number;
          }>) => {
            setMessagesList(msgs.map((m: typeof msgs[0]) => ({
              id: m.id,
              threadId: m.threadId,
              fromAgentId: m.fromAgentId,
              fromAgentName: m.fromAgentName,
              subject: m.subject,
              preview: m.preview,
              body: m.body,
              priority: m.priority as 'low' | 'normal' | 'high' | 'urgent',
              status: m.status as 'unread' | 'read' | 'archived' | 'injected',
              createdAt: m.createdAt,
              replyCount: m.replyCount,
            })));
            setMessagesPanelError(null);
            setShowMessagesPanel(true);
          }).catch((err: Error) => {
            setMessagesPanelError(err instanceof Error ? err.message : String(err));
            setShowMessagesPanel(true);
          });
        } else {
          setMessagesPanelError(null);
          setShowMessagesPanel(true);
        }
      } else if (chunk.panel === 'guardrails') {
        // Load guardrails and show panel
        if (!guardrailsStoreRef.current) {
          guardrailsStoreRef.current = new GuardrailsStore(cwd);
        }
        const config = guardrailsStoreRef.current.loadAll();
        const policies = guardrailsStoreRef.current.listPolicies();
        setGuardrailsConfig(config);
        setGuardrailsPolicies(policies);
        setShowGuardrailsPanel(true);
      } else if (chunk.panel === 'budget') {
        // Initialize budget tracker and show panel
        if (!budgetTrackerRef.current) {
          budgetTrackerRef.current = new BudgetTracker(activeSessionId || 'default');
        }
        const config = budgetTrackerRef.current.getConfig();
        const sessionStatus = budgetTrackerRef.current.checkBudget('session');
        const swarmStatus = budgetTrackerRef.current.checkBudget('swarm');
        setBudgetConfig(config);
        setSessionBudgetStatus(sessionStatus);
        setSwarmBudgetStatus(swarmStatus);
        setShowBudgetPanel(true);
      } else if (chunk.panel === 'agents') {
        // Load agents from registry and show panel
        const agentRegistry = getGlobalRegistry();
        const agents = agentRegistry.list();
        const stats = agentRegistry.getStats();
        setAgentsList(agents);
        setRegistryStats(stats);
        setShowAgentsPanel(true);
      }
    }
  }, [registry, exit, finalizeResponse, resetTurnState, cwd, activeSessionId]);

  // Load config files helper
  const loadConfigFiles = useCallback(async () => {
    try {
      // Load merged config
      const config = await loadConfig(cwd);
      setCurrentConfig(config);

      // Load individual config files for source tracking
      const { readFile, access } = await import('fs/promises');

      // User config
      const userPath = `${getConfigDir()}/config.json`;
      try {
        await access(userPath);
        const content = await readFile(userPath, 'utf-8');
        setUserConfig(JSON.parse(content));
      } catch {
        setUserConfig(null);
      }

      // Project config
      const projectPath = `${getProjectConfigDir(cwd)}/config.json`;
      try {
        await access(projectPath);
        const content = await readFile(projectPath, 'utf-8');
        setProjectConfig(JSON.parse(content));
      } catch {
        setProjectConfig(null);
      }

      // Local config
      const localPath = `${getProjectConfigDir(cwd)}/config.local.json`;
      try {
        await access(localPath);
        const content = await readFile(localPath, 'utf-8');
        setLocalConfig(JSON.parse(content));
      } catch {
        setLocalConfig(null);
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  }, [cwd]);

  // Create a session (either fresh or from recovery)
  const createSessionFromRecovery = useCallback(async (recoverSession: RecoverableSession | null) => {
    // Register chunk handler (only once, even on retry after error)
    if (!handlersRegisteredRef.current) {
      handlersRegisteredRef.current = true;
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
        // Trigger queue flush check after error
        setQueueFlushTrigger((prev) => prev + 1);
      });
    }

    // Load session data if recovering
    let initialMessages: Message[] | undefined;
    let sessionId: string | undefined;
    let startedAt: string | undefined;
    let effectiveCwd = cwd;

    if (recoverSession) {
      // Load saved session data
      const sessionData = SessionStorage.loadSession(recoverSession.sessionId);
      if (sessionData) {
        initialMessages = sessionData.messages as Message[];
        sessionId = recoverSession.sessionId;
        startedAt = sessionData.startedAt;
        effectiveCwd = sessionData.cwd || cwd;
      }
      // Clear recovery state files (heartbeat and state, but keep session storage)
      clearRecoveryState(recoverSession.sessionId);
    }

    // Create session (with or without initial messages)
    const session = await registry.createSession(effectiveCwd);

    // If recovering, we need to import the old messages
    // Since SessionRegistry doesn't support initialMessages, we'll display them in the UI
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
    }

    setActiveSessionId(session.id);
    session.client.setAskUserHandler((request) => beginAskUser(session.id, request));

    await loadSessionMetadata(session);

    setEnergyState(session.client.getEnergyState() ?? undefined);
    setVoiceState(session.client.getVoiceState() ?? undefined);
    setHeartbeatState(session.client.getHeartbeatState?.() ?? undefined);
    setIdentityInfo(session.client.getIdentityInfo() ?? undefined);

    // Initialize connector bridge for the connectors panel
    if (!connectorBridgeRef.current) {
      connectorBridgeRef.current = new ConnectorBridge(effectiveCwd);
      const discovered = connectorBridgeRef.current.fastDiscover();
      setConnectors(discovered);
    }

    initStateRef.current = 'done';
    setIsInitializing(false);
  }, [cwd, registry, handleChunk, finalizeResponse, resetTurnState, loadSessionMetadata, beginAskUser]);

  // Handle recovery panel actions
  const handleRecover = useCallback((session: RecoverableSession) => {
    setShowRecoveryPanel(false);
    // Clear recovery state for sessions we're not recovering
    for (const s of recoverableSessions) {
      if (s.sessionId !== session.sessionId) {
        clearRecoveryState(s.sessionId);
      }
    }
    createSessionFromRecovery(session).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setIsInitializing(false);
    });
  }, [recoverableSessions, createSessionFromRecovery]);

  const handleStartFresh = useCallback(() => {
    // Clear recovery state for all discarded sessions
    for (const session of recoverableSessions) {
      clearRecoveryState(session.sessionId);
    }
    setShowRecoveryPanel(false);
    setRecoverableSessions([]);
    createSessionFromRecovery(null).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setIsInitializing(false);
    });
  }, [recoverableSessions, createSessionFromRecovery]);

  // Initialize first session
  useEffect(() => {
    // Only skip if initialization completed successfully
    // Allow retry if we were interrupted (state is still 'idle' or was reset to 'idle')
    if (initStateRef.current === 'done') return;

    // If already pending, another instance is running
    if (initStateRef.current === 'pending') return;

    // If showing recovery panel, wait for user decision
    if (showRecoveryPanel) return;

    initStateRef.current = 'pending';

    let cancelled = false;

    const initSession = async () => {
      try {
        // Check for recoverable sessions first
        const foundSessions = findRecoverableSessions();
        if (foundSessions.length > 0 && recoverableSessions.length === 0) {
          // Show recovery panel listing all recoverable sessions
          setRecoverableSessions(foundSessions);
          setShowRecoveryPanel(true);
          initStateRef.current = 'idle'; // Allow re-entry after user decision
          return;
        }

        // No recovery needed, create fresh session
        await createSessionFromRecovery(null);
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
  }, [cwd, registry, showRecoveryPanel, recoverableSessions, createSessionFromRecovery]);

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
    const queueStartNow = Date.now();
    setProcessingStartTime(queueStartNow);
    processingStartTimeRef.current = queueStartNow; // Sync ref immediately for synchronous access
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

  // Process queue when not busy (not processing and no pending tools)
  // queueFlushTrigger forces re-evaluation when processing completes (done/error)
  useEffect(() => {
    if (!isBusy && activeQueue.length > 0 && activeInline.length === 0) {
      processQueue();
    }
  }, [isBusy, activeQueue.length, activeInline.length, processQueue, queueFlushTrigger]);

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
      setHeartbeatState(session.client.getHeartbeatState?.() ?? undefined);
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
      setHeartbeatState(newSession.client.getHeartbeatState?.() ?? undefined);
      setIdentityInfo(newSession.client.getIdentityInfo() ?? undefined);
      await loadSessionMetadata(newSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  }, [cwd, registry, saveCurrentSessionState, loadSessionState, beginAskUser]);


  // Handle keyboard shortcuts (inactive when session selector is shown)
  useInput((input, key) => {
    // Ctrl+]: show session selector (avoiding Ctrl+S which conflicts with terminal XOFF)
    if (key.ctrl && input === ']') {
      if (sessions.length > 0) {
        setShowSessionSelector(true);
      }
      return;
    }

    // Ctrl+C: stop processing, or double-tap to exit
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
        // Trigger queue flush check after stop
        setQueueFlushTrigger((prev) => prev + 1);
        // Reset exit hint state when stopping processing
        lastCtrlCRef.current = 0;
        setShowExitHint(false);
        return;
      }
      if (hasAsk) {
        return;
      }

      // Double Ctrl+C to exit (when not processing)
      const now = Date.now();
      const timeSinceLastCtrlC = now - lastCtrlCRef.current;
      if (timeSinceLastCtrlC < 1500 && lastCtrlCRef.current > 0) {
        // Double Ctrl+C - exit the app
        registry.closeAll();
        exit();
        return;
      }
      // First Ctrl+C - show hint and record timestamp
      lastCtrlCRef.current = now;
      setShowExitHint(true);
      // Hide hint after 2 seconds
      setTimeout(() => {
        setShowExitHint(false);
      }, 2000);
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
        // Trigger queue flush check after stop
        setQueueFlushTrigger((prev) => prev + 1);
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

      // Check for ![command] bash execution syntax
      // Converts to an instruction for the agent to run the bash command
      if (trimmedInput.startsWith('![') && trimmedInput.endsWith(']')) {
        const bashCommand = trimmedInput.slice(2, -1).trim();
        if (bashCommand) {
          // Convert to an explicit bash execution instruction
          const bashInstruction = `Run this bash command: \`${bashCommand}\``;
          return handleSubmit(bashInstruction, mode);
        }
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
        // Trigger queue flush check after clear/new interrupts processing
        setQueueFlushTrigger((prev) => prev + 1);
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
        // Trigger queue flush check after interrupt
        setQueueFlushTrigger((prev) => prev + 1);
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
        setLastWorkedFor(undefined);
        sessionUIStates.current.set(activeSession.id, {
          messages: [],
          currentResponse: '',
          activityLog: [],
          toolCalls: [],
          toolResults: [],
          tokenUsage,
          energyState,
          voiceState,
          heartbeatState,
          identityInfo,
          processingStartTime: undefined,
          currentTurnTokens: 0,
          error: null,
          lastWorkedFor: undefined,
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
      const submitStartNow = Date.now();
      setProcessingStartTime(submitStartNow);
      processingStartTimeRef.current = submitStartNow; // Sync ref immediately for synchronous access
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

  if (isInitializing && !showRecoveryPanel) {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Initializing..." />
      </Box>
    );
  }

  // Show recovery panel for crashed sessions
  if (showRecoveryPanel && recoverableSessions.length > 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <RecoveryPanel
          sessions={recoverableSessions}
          onRecover={handleRecover}
          onStartFresh={handleStartFresh}
        />
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

  // Show connectors panel
  if (showConnectorsPanel) {
    const handleCheckAuth = async (connector: Connector) => {
      if (!connectorBridgeRef.current) {
        return { authenticated: false, error: 'Not initialized' };
      }
      return connectorBridgeRef.current.checkAuthStatus(connector);
    };

    const handleGetCommandHelp = async (connector: Connector, command: string) => {
      if (!connectorBridgeRef.current) {
        return 'Not initialized';
      }
      return connectorBridgeRef.current.getCommandHelp(connector, command);
    };

    return (
      <Box flexDirection="column" padding={1}>
        <ConnectorsPanel
          connectors={connectors}
          initialConnector={connectorsPanelInitial}
          onCheckAuth={handleCheckAuth}
          onGetCommandHelp={handleGetCommandHelp}
          onClose={() => {
            setShowConnectorsPanel(false);
            setConnectorsPanelInitial(undefined);
          }}
        />
      </Box>
    );
  }

  // Show tasks panel
  if (showTasksPanel) {
    const handleTasksAdd = async (options: TaskCreateOptions) => {
      await addTask(cwd, options);
      setTasksList(await getTasks(cwd));
    };

    const handleTasksDelete = async (id: string) => {
      await deleteTask(cwd, id);
      setTasksList(await getTasks(cwd));
    };

    const handleTasksRun = async (id: string) => {
      await startTask(cwd, id);
      const task = tasksList.find((t) => t.id === id);
      if (task && activeSession) {
        // Send the task to the agent
        await activeSession.client.send(`Execute the following task:\n\n${task.description}\n\nWhen done, report the result.`);
      }
    };

    const handleTasksClearPending = async () => {
      await clearPendingTasks(cwd);
      setTasksList(await getTasks(cwd));
    };

    const handleTasksClearCompleted = async () => {
      await clearCompletedTasks(cwd);
      setTasksList(await getTasks(cwd));
    };

    const handleTasksTogglePause = async () => {
      const newPaused = !tasksPaused;
      await setPaused(cwd, newPaused);
      setTasksPaused(newPaused);
    };

    const handleTasksChangePriority = async (id: string, priority: TaskPriority) => {
      await updateTask(cwd, id, { priority });
      setTasksList(await getTasks(cwd));
    };

    return (
      <Box flexDirection="column" padding={1}>
        <TasksPanel
          tasks={tasksList}
          paused={tasksPaused}
          onAdd={handleTasksAdd}
          onDelete={handleTasksDelete}
          onRun={handleTasksRun}
          onClearPending={handleTasksClearPending}
          onClearCompleted={handleTasksClearCompleted}
          onTogglePause={handleTasksTogglePause}
          onChangePriority={handleTasksChangePriority}
          onClose={() => setShowTasksPanel(false)}
        />
      </Box>
    );
  }

  // Show schedules panel
  if (showSchedulesPanel) {
    const handleSchedulePause = async (id: string) => {
      await updateSchedule(cwd, id, (schedule) => ({
        ...schedule,
        status: 'paused',
        updatedAt: Date.now(),
      }));
      setSchedulesList(await listSchedules(cwd));
    };

    const handleScheduleResume = async (id: string) => {
      await updateSchedule(cwd, id, (schedule) => {
        const nextRun = computeNextRun(schedule, Date.now());
        return {
          ...schedule,
          status: 'active',
          updatedAt: Date.now(),
          nextRunAt: nextRun,
        };
      });
      setSchedulesList(await listSchedules(cwd));
    };

    const handleScheduleDelete = async (id: string) => {
      await deleteSchedule(cwd, id);
      setSchedulesList(await listSchedules(cwd));
    };

    const handleScheduleRun = async (id: string) => {
      const schedule = schedulesList.find((s) => s.id === id);
      if (schedule && activeSession) {
        // Execute the command now
        await activeSession.client.send(schedule.command);
      }
    };

    const handleScheduleRefresh = async () => {
      setSchedulesList(await listSchedules(cwd));
    };

    return (
      <Box flexDirection="column" padding={1}>
        <SchedulesPanel
          schedules={schedulesList}
          onPause={handleSchedulePause}
          onResume={handleScheduleResume}
          onDelete={handleScheduleDelete}
          onRun={handleScheduleRun}
          onRefresh={handleScheduleRefresh}
          onClose={() => setShowSchedulesPanel(false)}
        />
      </Box>
    );
  }

  // Show assistants panel
  if (showAssistantsPanel) {
    const assistantManager = activeSession?.client.getAssistantManager?.();
    const assistantsList = assistantManager?.listAssistants() ?? [];
    const activeAssistantId = assistantManager?.getActiveId() ?? undefined;

    const handleAssistantSelect = async (assistantId: string) => {
      setAssistantError(null);
      try {
        if (assistantManager) {
          await assistantManager.switchAssistant(assistantId);
          // Refresh identity context after switching
          await activeSession?.client.refreshIdentityContext?.();
          setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
          setAssistantsRefreshKey((k) => k + 1);
        }
        setShowAssistantsPanel(false);
      } catch (err) {
        setAssistantError(err instanceof Error ? err.message : 'Failed to switch assistant');
      }
    };

    const handleAssistantCreate = async (options: { name: string; description?: string; settings?: { model?: string; temperature?: number } }) => {
      setAssistantError(null);
      try {
        if (assistantManager) {
          await assistantManager.createAssistant(options);
          // Refresh identity context after creation
          await activeSession?.client.refreshIdentityContext?.();
          setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
          // Force refresh of assistants list
          setAssistantsRefreshKey((k) => k + 1);
        }
      } catch (err) {
        setAssistantError(err instanceof Error ? err.message : 'Failed to create assistant');
        throw err; // Re-throw so AssistantsPanel knows creation failed
      }
    };

    const handleAssistantUpdate = async (id: string, updates: Partial<{ name: string; description: string; settings: Record<string, unknown> }>) => {
      setAssistantError(null);
      try {
        if (assistantManager) {
          await assistantManager.updateAssistant(id, updates as any);
          // Refresh identity context after update
          await activeSession?.client.refreshIdentityContext?.();
          setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
          // Force refresh of assistants list
          setAssistantsRefreshKey((k) => k + 1);
        }
      } catch (err) {
        setAssistantError(err instanceof Error ? err.message : 'Failed to update assistant');
        throw err; // Re-throw so AssistantsPanel knows update failed
      }
    };

    const handleAssistantDelete = async (assistantId: string) => {
      setAssistantError(null);
      try {
        if (assistantManager) {
          await assistantManager.deleteAssistant(assistantId);
          // Refresh identity context after deletion
          await activeSession?.client.refreshIdentityContext?.();
          setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
          // Force refresh of assistants list
          setAssistantsRefreshKey((k) => k + 1);
        }
      } catch (err) {
        setAssistantError(err instanceof Error ? err.message : 'Failed to delete assistant');
        throw err; // Re-throw so AssistantsPanel knows deletion failed
      }
    };

    return (
      <Box flexDirection="column" padding={1}>
        <AssistantsPanel
          assistants={assistantsList}
          activeAssistantId={activeAssistantId}
          onSelect={handleAssistantSelect}
          onCreate={handleAssistantCreate}
          onUpdate={handleAssistantUpdate}
          onDelete={handleAssistantDelete}
          onCancel={() => {
            setAssistantError(null);
            setShowAssistantsPanel(false);
          }}
          error={assistantError}
          onClearError={() => setAssistantError(null)}
        />
      </Box>
    );
  }

  // Show hooks panel
  if (showHooksPanel) {
    const handleHookToggle = (event: HookEvent, hookId: string, enabled: boolean) => {
      if (!hookStoreRef.current) {
        hookStoreRef.current = new HookStore(cwd);
      }
      hookStoreRef.current.setEnabled(hookId, enabled);
      const hooks = hookStoreRef.current.loadAll();
      setHooksConfig(hooks);
    };

    const handleHookDelete = async (event: HookEvent, hookId: string) => {
      if (!hookStoreRef.current) {
        hookStoreRef.current = new HookStore(cwd);
      }
      hookStoreRef.current.removeHook(hookId);
      const hooks = hookStoreRef.current.loadAll();
      setHooksConfig(hooks);
    };

    const handleHookAdd = async (
      event: HookEvent,
      handler: HookHandler,
      location: 'user' | 'project' | 'local',
      matcher?: string
    ) => {
      if (!hookStoreRef.current) {
        hookStoreRef.current = new HookStore(cwd);
      }
      hookStoreRef.current.addHook(event, handler, location, matcher);
      const hooks = hookStoreRef.current.loadAll();
      setHooksConfig(hooks);
    };

    const handleNativeHookToggle = (hookId: string, enabled: boolean) => {
      nativeHookRegistry.setEnabled(hookId, enabled);
    };

    // Get native hooks
    const nativeHooks = nativeHookRegistry.listFlat();

    return (
      <Box flexDirection="column" padding={1}>
        <HooksPanel
          hooks={hooksConfig}
          nativeHooks={nativeHooks}
          onToggle={handleHookToggle}
          onToggleNative={handleNativeHookToggle}
          onDelete={handleHookDelete}
          onAdd={handleHookAdd}
          onCancel={() => setShowHooksPanel(false)}
        />
      </Box>
    );
  }

  // Show guardrails panel
  if (showGuardrailsPanel && guardrailsConfig) {
    const handleToggleEnabled = (enabled: boolean) => {
      if (!guardrailsStoreRef.current) {
        guardrailsStoreRef.current = new GuardrailsStore(cwd);
      }
      guardrailsStoreRef.current.setEnabled(enabled, 'project');
      const config = guardrailsStoreRef.current.loadAll();
      const policies = guardrailsStoreRef.current.listPolicies();
      setGuardrailsConfig(config);
      setGuardrailsPolicies(policies);
    };

    const handleTogglePolicy = (policyId: string, enabled: boolean) => {
      if (!guardrailsStoreRef.current) {
        guardrailsStoreRef.current = new GuardrailsStore(cwd);
      }
      guardrailsStoreRef.current.setPolicyEnabled(policyId, enabled);
      const config = guardrailsStoreRef.current.loadAll();
      const policies = guardrailsStoreRef.current.listPolicies();
      setGuardrailsConfig(config);
      setGuardrailsPolicies(policies);
    };

    const handleSetPreset = (preset: 'permissive' | 'restrictive') => {
      if (!guardrailsStoreRef.current) {
        guardrailsStoreRef.current = new GuardrailsStore(cwd);
      }
      const policy = preset === 'permissive' ? PERMISSIVE_POLICY : RESTRICTIVE_POLICY;
      guardrailsStoreRef.current.addPolicy({ ...policy }, 'project');
      guardrailsStoreRef.current.setEnabled(true, 'project');
      const config = guardrailsStoreRef.current.loadAll();
      const policies = guardrailsStoreRef.current.listPolicies();
      setGuardrailsConfig(config);
      setGuardrailsPolicies(policies);
    };

    return (
      <Box flexDirection="column" padding={1}>
        <GuardrailsPanel
          config={guardrailsConfig}
          policies={guardrailsPolicies}
          onToggleEnabled={handleToggleEnabled}
          onTogglePolicy={handleTogglePolicy}
          onSetPreset={handleSetPreset}
          onCancel={() => setShowGuardrailsPanel(false)}
        />
      </Box>
    );
  }

  // Show budget panel
  if (showBudgetPanel && budgetConfig && sessionBudgetStatus && swarmBudgetStatus) {
    const handleBudgetToggleEnabled = (enabled: boolean) => {
      if (!budgetTrackerRef.current) {
        budgetTrackerRef.current = new BudgetTracker(activeSessionId || 'default');
      }
      budgetTrackerRef.current.setEnabled(enabled);
      const config = budgetTrackerRef.current.getConfig();
      const sessionStatus = budgetTrackerRef.current.checkBudget('session');
      const swarmStatus = budgetTrackerRef.current.checkBudget('swarm');
      setBudgetConfig(config);
      setSessionBudgetStatus(sessionStatus);
      setSwarmBudgetStatus(swarmStatus);
    };

    const handleBudgetReset = (scope: BudgetScope) => {
      if (!budgetTrackerRef.current) {
        budgetTrackerRef.current = new BudgetTracker(activeSessionId || 'default');
      }
      budgetTrackerRef.current.resetUsage(scope);
      const sessionStatus = budgetTrackerRef.current.checkBudget('session');
      const swarmStatus = budgetTrackerRef.current.checkBudget('swarm');
      setSessionBudgetStatus(sessionStatus);
      setSwarmBudgetStatus(swarmStatus);
    };

    const handleBudgetSetLimits = (scope: BudgetScope, limits: Partial<BudgetLimits>) => {
      if (!budgetTrackerRef.current) {
        budgetTrackerRef.current = new BudgetTracker(activeSessionId || 'default');
      }
      // Update config with new limits for the scope
      const currentConfig = budgetTrackerRef.current.getConfig();
      const updatedConfig: Partial<BudgetConfig> = {
        [scope]: { ...(currentConfig[scope] || {}), ...limits },
      };
      budgetTrackerRef.current.updateConfig(updatedConfig);
      const config = budgetTrackerRef.current.getConfig();
      const sessionStatus = budgetTrackerRef.current.checkBudget('session');
      const swarmStatus = budgetTrackerRef.current.checkBudget('swarm');
      setBudgetConfig(config);
      setSessionBudgetStatus(sessionStatus);
      setSwarmBudgetStatus(swarmStatus);
    };

    return (
      <Box flexDirection="column" padding={1}>
        <BudgetPanel
          config={budgetConfig}
          sessionStatus={sessionBudgetStatus}
          swarmStatus={swarmBudgetStatus}
          onToggleEnabled={handleBudgetToggleEnabled}
          onReset={handleBudgetReset}
          onSetLimits={handleBudgetSetLimits}
          onCancel={() => setShowBudgetPanel(false)}
        />
      </Box>
    );
  }

  // Show agents panel
  if (showAgentsPanel && registryStats) {
    const handleAgentsRefresh = () => {
      const agentRegistry = getGlobalRegistry();
      const agents = agentRegistry.list();
      const stats = agentRegistry.getStats();
      setAgentsList(agents);
      setRegistryStats(stats);
    };

    return (
      <Box flexDirection="column" padding={1}>
        <AgentsPanel
          agents={agentsList}
          stats={registryStats}
          onRefresh={handleAgentsRefresh}
          onCancel={() => setShowAgentsPanel(false)}
        />
      </Box>
    );
  }

  // Show config panel
  if (showConfigPanel && currentConfig) {
    const handleConfigSave = async (
      location: 'user' | 'project' | 'local',
      updates: Partial<AssistantsConfig>
    ) => {
      const { writeFile, mkdir } = await import('fs/promises');
      const { dirname } = await import('path');

      let configPath: string;
      let existingConfig: Partial<AssistantsConfig> | null;

      switch (location) {
        case 'user':
          configPath = `${getConfigDir()}/config.json`;
          existingConfig = userConfig;
          break;
        case 'project':
          configPath = `${getProjectConfigDir(cwd)}/config.json`;
          existingConfig = projectConfig;
          break;
        case 'local':
          configPath = `${getProjectConfigDir(cwd)}/config.local.json`;
          existingConfig = localConfig;
          break;
      }

      // Merge updates with existing config
      const newConfig = deepMerge(existingConfig || {}, updates);

      // Ensure directory exists
      await mkdir(dirname(configPath), { recursive: true });

      // Write config
      await writeFile(configPath, JSON.stringify(newConfig, null, 2));

      // Reload config files
      await loadConfigFiles();
    };

    return (
      <Box flexDirection="column" padding={1}>
        <ConfigPanel
          config={currentConfig}
          userConfig={userConfig}
          projectConfig={projectConfig}
          localConfig={localConfig}
          onSave={handleConfigSave}
          onCancel={() => setShowConfigPanel(false)}
        />
      </Box>
    );
  }

  // Show messages panel
  if (showMessagesPanel) {
    const messagesManager = activeSession?.client.getMessagesManager?.();

    const handleMessagesRead = async (id: string) => {
      if (!messagesManager) throw new Error('Messages not available');
      const msg = await messagesManager.read(id);
      return {
        id: msg.id,
        threadId: msg.threadId,
        fromAgentId: msg.fromAgentId,
        fromAgentName: msg.fromAgentName,
        subject: msg.subject,
        preview: msg.preview,
        body: msg.body,
        priority: msg.priority as 'low' | 'normal' | 'high' | 'urgent',
        status: msg.status as 'unread' | 'read' | 'archived' | 'injected',
        createdAt: msg.createdAt,
        replyCount: msg.replyCount,
      };
    };

    const handleMessagesDelete = async (id: string) => {
      if (!messagesManager) throw new Error('Messages not available');
      await messagesManager.delete(id);
      // Refresh the messages list
      const msgs = await messagesManager.list({ limit: 50 });
      setMessagesList(msgs.map((m: { id: string; threadId: string; fromAgentId: string; fromAgentName: string; subject?: string; preview: string; body?: string; priority: string; status: string; createdAt: string; replyCount?: number }) => ({
        id: m.id,
        threadId: m.threadId,
        fromAgentId: m.fromAgentId,
        fromAgentName: m.fromAgentName,
        subject: m.subject,
        preview: m.preview,
        body: m.body,
        priority: m.priority as 'low' | 'normal' | 'high' | 'urgent',
        status: m.status as 'unread' | 'read' | 'archived' | 'injected',
        createdAt: m.createdAt,
        replyCount: m.replyCount,
      })));
    };

    const handleMessagesInject = async (id: string) => {
      if (!messagesManager) throw new Error('Messages not available');
      const msg = await messagesManager.read(id);
      // Inject the message content into the current conversation
      if (activeSession) {
        activeSession.client.addSystemMessage(`[Injected message from ${msg.fromAgentName}]\n\n${msg.body || msg.preview}`);
      }
      // Mark as injected
      await messagesManager.markStatus?.(id, 'injected');
      // Refresh the messages list
      const msgs = await messagesManager.list({ limit: 50 });
      setMessagesList(msgs.map((m: { id: string; threadId: string; fromAgentId: string; fromAgentName: string; subject?: string; preview: string; body?: string; priority: string; status: string; createdAt: string; replyCount?: number }) => ({
        id: m.id,
        threadId: m.threadId,
        fromAgentId: m.fromAgentId,
        fromAgentName: m.fromAgentName,
        subject: m.subject,
        preview: m.preview,
        body: m.body,
        priority: m.priority as 'low' | 'normal' | 'high' | 'urgent',
        status: m.status as 'unread' | 'read' | 'archived' | 'injected',
        createdAt: m.createdAt,
        replyCount: m.replyCount,
      })));
    };

    const handleMessagesReply = async (id: string, body: string) => {
      if (!messagesManager) throw new Error('Messages not available');
      const msg = await messagesManager.read(id);
      // Send reply using the messages manager
      await messagesManager.send({
        to: msg.fromAgentId,
        body,
        replyTo: id,
      });
    };

    if (!messagesManager) {
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">Messages</Text>
          </Box>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            paddingY={1}
          >
            <Text>Messages are not enabled.</Text>
            <Text dimColor>Configure messages in config.json to enable.</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>q quit</Text>
          </Box>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" padding={1}>
        <MessagesPanel
          messages={messagesList}
          onRead={handleMessagesRead}
          onDelete={handleMessagesDelete}
          onInject={handleMessagesInject}
          onReply={handleMessagesReply}
          onClose={() => setShowMessagesPanel(false)}
          error={messagesPanelError}
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
            {backgroundProcessingCount} session{backgroundProcessingCount > 1 ? 's' : ''} processing in background (Ctrl+] to switch)
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

      {/* Worked-for timer - shows only most recent, sticky above input */}
      {!isProcessing && lastWorkedFor && (
        <Box marginBottom={0} marginLeft={2}>
          <Text color="gray">✻ Worked for {lastWorkedFor}</Text>
        </Box>
      )}

      {/* Exit hint for double Ctrl+C */}
      {showExitHint && (
        <Box marginLeft={2} marginBottom={0}>
          <Text color="yellow">(Press Ctrl+C again to exit)</Text>
        </Box>
      )}

      {/* Input - always enabled, supports queue/interrupt */}
      <Input
        onSubmit={handleSubmit}
        isProcessing={isBusy}
        queueLength={activeQueue.length + inlineCount}
        commands={commands}
        skills={skills}
        isAskingUser={Boolean(activeAskQuestion)}
        askPlaceholder={askPlaceholder}
        allowBlankAnswer={activeAskQuestion?.required === false}
      />

      {/* Status bar */}
      <Status
        isProcessing={isBusy}
        cwd={activeSession?.cwd || cwd}
        queueLength={activeQueue.length + inlineCount}
        tokenUsage={tokenUsage}
        energyState={energyState}
        voiceState={voiceState}
        heartbeatState={heartbeatState}
        identityInfo={identityInfo}
        sessionIndex={sessionIndex}
        sessionCount={sessionCount}
        backgroundProcessingCount={backgroundProcessingCount}
        processingStartTime={processingStartTime}
        verboseTools={verboseTools}
      />
    </Box>
  );
}

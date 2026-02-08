import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { Box, Text, useApp, useStdout, Static } from 'ink';
import { SessionRegistry, SessionStorage, findRecoverableSessions, clearRecoveryState, ConnectorBridge, listTemplates, createIdentityFromTemplate, VoiceManager, AudioRecorder, ElevenLabsSTT, WhisperSTT, readHeartbeatHistoryBySession, type SessionInfo, type RecoverableSession, type CreateIdentityOptions, type Heartbeat, type SavedSessionInfo, type CreateSessionOptions, type Identity, type Memory, type MemoryStats } from '@hasna/assistants-core';
import type { StreamChunk, Message, ToolCall, ToolResult, TokenUsage, EnergyState, VoiceState, HeartbeatState, ActiveIdentityInfo, AskUserRequest, AskUserResponse, Connector, HookConfig, HookEvent, HookHandler, ScheduledCommand, Skill } from '@hasna/assistants-shared';
import { generateId, now } from '@hasna/assistants-shared';
import { Input, type InputHandle } from './Input';
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
import { IdentityPanel } from './IdentityPanel';
import { HooksPanel } from './HooksPanel';
import { ConfigPanel } from './ConfigPanel';
import { MessagesPanel } from './MessagesPanel';
import { WebhooksPanel } from './WebhooksPanel';
import { ChannelsPanel } from './ChannelsPanel';
import { parseMentions, resolveNameToKnown, type ChannelMember } from '@hasna/assistants-core';
import { PeoplePanel } from './PeoplePanel';
import { TelephonyPanel } from './TelephonyPanel';
import { OrdersPanel } from './OrdersPanel';
import { OnboardingPanel, type OnboardingResult } from './OnboardingPanel';
import { GuardrailsPanel } from './GuardrailsPanel';
import { BudgetPanel } from './BudgetPanel';
import { AssistantsRegistryPanel } from './AssistantsRegistryPanel';
import { SchedulesPanel } from './SchedulesPanel';
import { SkillsPanel } from './SkillsPanel';
import { MemoryPanel } from './MemoryPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { PlansPanel } from './PlansPanel';
import { WalletPanel } from './WalletPanel';
import { SecretsPanel } from './SecretsPanel';
import { WorkspacePanel } from './WorkspacePanel';
import { AssistantsDashboard } from './AssistantsDashboard';
import { SwarmPanel } from './SwarmPanel';
import { LogsPanel } from './LogsPanel';
import { HeartbeatPanel } from './HeartbeatPanel';
import { ResumePanel } from './ResumePanel';
import type { QueuedMessage } from './appTypes';
import type { Email, EmailListItem } from '@hasna/assistants-shared';
import { CLEAR_SCREEN_TOKEN } from '../output/sanitize';
import { useSafeInput as useInput } from '../hooks/useSafeInput';
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
  type RegisteredAssistant,
  type RegistryStats,
  listSchedules,
  saveSchedule,
  deleteSchedule,
  updateSchedule,
  computeNextRun,
  listProjects,
  createProject,
  deleteProject,
  updateProject,
  readProject,
  type ProjectRecord,
  type ProjectPlan,
  type PlanStepStatus,
  type SerializableSwarmState,
  type SwarmConfig,
  createSkill,
  deleteSkill,
  type CreateSkillOptions,
} from '@hasna/assistants-core';
import type { BudgetConfig, BudgetLimits } from '@hasna/assistants-shared';
import type { AssistantsConfig } from '@hasna/assistants-shared';

const SHOW_ERROR_CODES = process.env.ASSISTANTS_DEBUG === '1';
const MAX_SHELL_OUTPUT_BYTES = 64 * 1024;

type ShellResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
};

async function runShellCommand(command: string, cwd: string): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, env: process.env });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;

    const collect = (chunk: Buffer, target: Buffer[]) => {
      if (totalBytes >= MAX_SHELL_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      const remaining = MAX_SHELL_OUTPUT_BYTES - totalBytes;
      if (chunk.length > remaining) {
        target.push(chunk.slice(0, remaining));
        totalBytes = MAX_SHELL_OUTPUT_BYTES;
        truncated = true;
        return;
      }
      target.push(chunk);
      totalBytes += chunk.length;
    };

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => collect(chunk, stdoutChunks));
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => collect(chunk, stderrChunks));
    }

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trimEnd(),
        stderr: Buffer.concat(stderrChunks).toString('utf8').trimEnd(),
        exitCode: code,
        truncated,
      });
    });
  });
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

interface IdentityPanelIntent {
  id?: string;
  mode?: 'detail' | 'edit';
}

const MESSAGE_CHUNK_LINES = 12;
const MESSAGE_WRAP_CHARS = 120;

function CloseOnAnyKeyPanel({ message, onClose }: { message: string; onClose: () => void }) {
  useInput(() => {
    onClose();
  }, { isActive: true });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="red">{message}</Text>
      <Text color="gray">Press any key to close.</Text>
    </Box>
  );
}

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

  // Skills panel state
  const [showSkillsPanel, setShowSkillsPanel] = useState(false);
  const [skillsList, setSkillsList] = useState<Skill[]>([]);

  // Assistants panel state
  const [showAssistantsPanel, setShowAssistantsPanel] = useState(false);
  const [assistantsRefreshKey, setAssistantsRefreshKey] = useState(0);
  const [assistantError, setAssistantError] = useState<string | null>(null);

  // Identity panel state
  const [showIdentityPanel, setShowIdentityPanel] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityPanelIntent, setIdentityPanelIntent] = useState<IdentityPanelIntent | null>(null);
  const [identitiesList, setIdentitiesList] = useState<Identity[]>([]);

  // Memory panel state
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [memoryList, setMemoryList] = useState<Memory[]>([]);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);

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

  // Assistants panel state
  const [showAssistantsRegistryPanel, setShowAssistantsRegistryPanel] = useState(false);
  const [assistantsList, setAssistantsList] = useState<RegisteredAssistant[]>([]);
  const [registryStats, setRegistryStats] = useState<RegistryStats | null>(null);

  // Config panel state
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<AssistantsConfig | null>(null);
  const [userConfig, setUserConfig] = useState<Partial<AssistantsConfig> | null>(null);
  const [projectConfig, setProjectConfig] = useState<Partial<AssistantsConfig> | null>(null);
  const [localConfig, setLocalConfig] = useState<Partial<AssistantsConfig> | null>(null);

  // Webhooks panel state
  const [showWebhooksPanel, setShowWebhooksPanel] = useState(false);

  // Channels panel state
  const [showChannelsPanel, setShowChannelsPanel] = useState(false);

  // People panel state
  const [showPeoplePanel, setShowPeoplePanel] = useState(false);

  // Telephony panel state
  const [showTelephonyPanel, setShowTelephonyPanel] = useState(false);

  // Orders panel state
  const [showOrdersPanel, setShowOrdersPanel] = useState(false);

  // Onboarding panel state
  const [showOnboardingPanel, setShowOnboardingPanel] = useState(false);

  // Messages panel state
  const [showMessagesPanel, setShowMessagesPanel] = useState(false);
  const [messagesPanelError, setMessagesPanelError] = useState<string | null>(null);
  const [messagesList, setMessagesList] = useState<Array<{
    id: string;
    threadId: string;
    fromAssistantId: string;
    fromAssistantName: string;
    subject?: string;
    preview: string;
    body?: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    status: 'unread' | 'read' | 'archived' | 'injected';
    createdAt: string;
    replyCount?: number;
  }>>([]);

  // Projects panel state
  const [showProjectsPanel, setShowProjectsPanel] = useState(false);
  const [projectsList, setProjectsList] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>();

  // Plans panel state (shown for a specific project)
  const [showPlansPanel, setShowPlansPanel] = useState(false);
  const [plansProject, setPlansProject] = useState<ProjectRecord | null>(null);

  // Wallet panel state
  const [showWalletPanel, setShowWalletPanel] = useState(false);
  const [walletCards, setWalletCards] = useState<Array<{ id: string; name: string; last4: string; brand?: string; expiryMonth?: number; expiryYear?: number; isDefault?: boolean; createdAt?: string }>>([]);
  const [walletError, setWalletError] = useState<string | null>(null);

  // Secrets panel state
  const [showSecretsPanel, setShowSecretsPanel] = useState(false);
  const [secretsList, setSecretsList] = useState<Array<{ name: string; scope: 'global' | 'assistant'; createdAt?: string; updatedAt?: string }>>([]);
  const [secretsError, setSecretsError] = useState<string | null>(null);

  // Inbox data (loaded alongside messages panel)
  const [inboxEmails, setInboxEmails] = useState<EmailListItem[]>([]);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [inboxEnabled, setInboxEnabled] = useState(false);

  // Assistants dashboard panel state
  const [showAssistantsDashboard, setShowAssistantsDashboard] = useState(false);

  // Swarm panel state
  const [showSwarmPanel, setShowSwarmPanel] = useState(false);

  // Workspace panel state
  const [showWorkspacePanel, setShowWorkspacePanel] = useState(false);
  const [workspacesList, setWorkspacesList] = useState<Array<{ id: string; name: string; description?: string; createdAt: number; updatedAt: number; createdBy: string; participants: string[]; status: 'active' | 'archived' }>>([]);

  // Logs panel state
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [showHeartbeatPanel, setShowHeartbeatPanel] = useState(false);
  const [heartbeatRuns, setHeartbeatRuns] = useState<Heartbeat[]>([]);
  const [showResumePanel, setShowResumePanel] = useState(false);
  const [resumeSessions, setResumeSessions] = useState<SavedSessionInfo[]>([]);
  const [resumeFilter, setResumeFilter] = useState<'cwd' | 'all'>('cwd');
  const [staticResetKey, setStaticResetKey] = useState(0);

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
  const [isListening, setIsListening] = useState(false);
  const [listeningDraft, setListeningDraft] = useState('');

  const renderedMessageIdsRef = useRef<Set<string>>(new Set());
  const cachedDisplayMessagesRef = useRef<Map<string, ReturnType<typeof buildDisplayMessages>[0][]>>(new Map());

  // Push-to-talk state
  const [pttRecording, setPttRecording] = useState(false);
  const [pttTranscribing, setPttTranscribing] = useState(false);
  const pttRecorderRef = useRef<AudioRecorder | null>(null);

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
  const inputRef = useRef<InputHandle>(null);
  const isListeningRef = useRef(isListening);
  const listenLoopRef = useRef<{
    active: boolean;
    buffer: string;
    silenceMs: number;
    manager: VoiceManager | null;
  }>({
    active: false,
    buffer: '',
    silenceMs: 0,
    manager: null,
  });

  const isPanelOpen = (
    showOnboardingPanel ||
    showRecoveryPanel ||
    showConnectorsPanel ||
    showTasksPanel ||
    showSchedulesPanel ||
    showSkillsPanel ||
    showAssistantsPanel ||
    showIdentityPanel ||
    showMemoryPanel ||
    showHooksPanel ||
    showGuardrailsPanel ||
    showBudgetPanel ||
    showAssistantsRegistryPanel ||
    showConfigPanel ||
    showWebhooksPanel ||
    showChannelsPanel ||
    showPeoplePanel ||
    showTelephonyPanel ||
    showOrdersPanel ||
    showMessagesPanel ||
    showProjectsPanel ||
    showPlansPanel ||
    showWalletPanel ||
    showSecretsPanel ||
    showWorkspacePanel ||
    showAssistantsDashboard ||
    showSwarmPanel ||
    showLogsPanel ||
    showHeartbeatPanel ||
    showResumePanel
  );
  const sendListenMessageRef = useRef<(text: string) => void>(() => {});
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
    isListeningRef.current = isListening;
  }, [isListening]);

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
    processingStartTimeRef.current = undefined; // Sync ref immediately to avoid stale values
    setCurrentTurnTokens(0);
  }, []);

  const appendTranscript = useCallback((base: string, chunk: string) => {
    const trimmed = chunk.trim();
    if (!trimmed) return base;
    if (!base) return trimmed;
    const lastChar = base[base.length - 1] || '';
    const needsSpace = lastChar !== ' ' && !/[.,!?;:]/.test(trimmed[0] || '');
    return `${base}${needsSpace ? ' ' : ''}${trimmed}`;
  }, []);

  const updateListenDraft = useCallback((next: string) => {
    setListeningDraft(next);
    inputRef.current?.setValue(next);
  }, []);

  const stopListening = useCallback(() => {
    if (!listenLoopRef.current.active) return;
    listenLoopRef.current.active = false;
    listenLoopRef.current.silenceMs = 0;
    listenLoopRef.current.buffer = '';
    listenLoopRef.current.manager?.stopListening();
    listenLoopRef.current.manager = null;
    setListeningDraft('');
    setIsListening(false);
    isListeningRef.current = false;
  }, []);

  const startListening = useCallback(async () => {
    if (listenLoopRef.current.active) return;
    listenLoopRef.current.active = true;
    setIsListening(true);
    isListeningRef.current = true;

    let config: AssistantsConfig;
    try {
      config = currentConfig ?? await loadConfig(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config for voice');
      stopListening();
      return;
    }

    if (!listenLoopRef.current.active) return;

    const voiceConfig = config.voice;
    if (!voiceConfig) {
      setError('Voice configuration is missing. Add voice settings to config.json.');
      stopListening();
      return;
    }

    if (voiceConfig.stt.provider === 'system') {
      setError('System speech-to-text is not available yet. Set voice.stt.provider to "whisper".');
      stopListening();
      return;
    }

    const manager = new VoiceManager({
      ...voiceConfig,
      enabled: true,
      stt: { ...voiceConfig.stt },
      tts: { ...voiceConfig.tts },
    });
    manager.enable();
    listenLoopRef.current.manager = manager;
    listenLoopRef.current.buffer = inputRef.current?.getValue() ?? '';
    listenLoopRef.current.silenceMs = 0;
    updateListenDraft(listenLoopRef.current.buffer);

    const chunkSeconds = 1;
    const silenceThresholdMs = 3500;

    while (listenLoopRef.current.active) {
      let transcript = '';
      try {
        transcript = await manager.listen({ durationSeconds: chunkSeconds });
      } catch (err) {
        if (!listenLoopRef.current.active) break;
        setError(err instanceof Error ? err.message : String(err));
        stopListening();
        break;
      }

      if (!listenLoopRef.current.active) break;

      const trimmed = transcript.trim();
      if (trimmed) {
        listenLoopRef.current.silenceMs = 0;
        const next = appendTranscript(listenLoopRef.current.buffer, trimmed);
        listenLoopRef.current.buffer = next;
        updateListenDraft(next);
        continue;
      }

      listenLoopRef.current.silenceMs += chunkSeconds * 1000;
      if (listenLoopRef.current.silenceMs >= silenceThresholdMs) {
        const payload = listenLoopRef.current.buffer.trim();
        listenLoopRef.current.buffer = '';
        listenLoopRef.current.silenceMs = 0;
        updateListenDraft('');
        if (payload) {
          sendListenMessageRef.current(payload);
        }
      }
    }
  }, [appendTranscript, cwd, currentConfig, stopListening, updateListenDraft]);

  useEffect(() => () => {
    stopListening();
  }, [stopListening]);

  // Push-to-talk: toggle recording
  const togglePushToTalk = useCallback(async () => {
    // If transcribing, ignore toggle
    if (pttTranscribing) return;

    // If already recording, stop and transcribe
    if (pttRecording) {
      setPttRecording(false);
      const recorder = pttRecorderRef.current;
      if (!recorder) return;
      recorder.stop();
      // Audio will be captured from the record() promise
      return;
    }

    // Start recording
    setPttRecording(true);
    const recorder = new AudioRecorder();
    pttRecorderRef.current = recorder;

    let audioBuffer: ArrayBuffer;
    try {
      audioBuffer = await recorder.record({ durationSeconds: 120 });
    } catch (err) {
      setPttRecording(false);
      pttRecorderRef.current = null;
      setError(err instanceof Error ? err.message : 'Failed to start recording');
      return;
    }

    // Recording stopped (either by toggle or by reaching max duration)
    setPttRecording(false);
    pttRecorderRef.current = null;

    if (!audioBuffer || audioBuffer.byteLength === 0) return;

    // Transcribe
    setPttTranscribing(true);
    try {
      // Auto-detect STT provider: config → ELEVENLABS_API_KEY → OPENAI_API_KEY
      let stt: { transcribe(audio: ArrayBuffer): Promise<{ text: string }> };
      const config = currentConfig ?? await loadConfig(cwd);
      const sttConfig = config?.voice?.stt;

      if (sttConfig?.provider === 'elevenlabs') {
        stt = new ElevenLabsSTT({ model: sttConfig.model, language: sttConfig.language });
      } else if (sttConfig?.provider === 'whisper') {
        stt = new WhisperSTT({ model: sttConfig.model, language: sttConfig.language });
      } else if (process.env.ELEVENLABS_API_KEY) {
        stt = new ElevenLabsSTT();
      } else if (process.env.OPENAI_API_KEY) {
        stt = new WhisperSTT();
      } else {
        throw new Error('No STT API key found. Set ELEVENLABS_API_KEY or OPENAI_API_KEY.');
      }

      const result = await stt.transcribe(audioBuffer);
      const text = result.text.trim();
      if (text) {
        inputRef.current?.appendValue(text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed');
    } finally {
      setPttTranscribing(false);
    }
  }, [pttRecording, pttTranscribing, currentConfig, cwd]);

  // Cleanup PTT on unmount
  useEffect(() => () => {
    if (pttRecorderRef.current) {
      pttRecorderRef.current.stop();
      pttRecorderRef.current = null;
    }
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
      processingStartTimeRef.current = state.processingStartTime; // Sync ref immediately
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
      processingStartTimeRef.current = undefined; // Sync ref immediately
      setCurrentTurnTokens(0);
      setError(null);
      setLastWorkedFor(undefined);
      setAskUserState(askState);
    }
  }, []);

  const clearSessionWindow = useCallback(() => {
    if (stdout?.write) {
      stdout.write(CLEAR_SCREEN_TOKEN);
    } else if (process.stdout?.write) {
      process.stdout.write(CLEAR_SCREEN_TOKEN);
    }
    renderedMessageIdsRef.current.clear();
    cachedDisplayMessagesRef.current.clear();
    setStaticResetKey((prev) => prev + 1);
  }, [stdout]);

  const switchToSession = useCallback(async (sessionId: string) => {
    if (sessionId === activeSessionId) {
      return;
    }

    saveCurrentSessionState();
    clearSessionWindow();

    // Load new session state BEFORE switching (prevents race with buffered chunk replay)
    loadSessionState(sessionId);

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
  }, [
    activeSessionId,
    saveCurrentSessionState,
    clearSessionWindow,
    loadSessionState,
    registry,
    loadSessionMetadata,
  ]);

  const createAndActivateSession = useCallback(async (options: CreateSessionOptions) => {
    saveCurrentSessionState();
    const newSession = await registry.createSession(options);
    newSession.client.setAskUserHandler((request) => beginAskUser(newSession.id, request));

    clearSessionWindow();

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

    return newSession;
  }, [registry, beginAskUser, clearSessionWindow, loadSessionState, loadSessionMetadata, saveCurrentSessionState]);

  const seedSessionState = useCallback((sessionId: string, seededMessages: Message[]) => {
    sessionUIStates.current.set(sessionId, {
      messages: seededMessages,
      currentResponse: '',
      activityLog: [],
      toolCalls: [],
      toolResults: [],
      tokenUsage: undefined,
      energyState: undefined,
      voiceState: undefined,
      heartbeatState: undefined,
      identityInfo: undefined,
      processingStartTime: undefined,
      currentTurnTokens: 0,
      error: null,
      lastWorkedFor: undefined,
    });
  }, []);

  const refreshResumeSessions = useCallback(async () => {
    setResumeSessions(SessionStorage.listAllSessions());
  }, []);

  const resumeFromSavedSession = useCallback(async (saved: SavedSessionInfo) => {
    setShowResumePanel(false);

    const sessionData = SessionStorage.loadSession(saved.id, saved.assistantId ?? null);
    if (!sessionData) {
      setError('Failed to load saved session.');
      return;
    }

    let session = registry.getSession(saved.id);
    if (!session) {
      try {
        session = await registry.createSession({
          cwd: sessionData.cwd || cwd,
          assistantId: saved.assistantId || undefined,
          sessionId: saved.id,
          initialMessages: sessionData.messages as Message[],
          startedAt: sessionData.startedAt,
        });
      } catch (error) {
        session = await registry.createSession({
          cwd: sessionData.cwd || cwd,
          assistantId: saved.assistantId || undefined,
          initialMessages: sessionData.messages as Message[],
          startedAt: sessionData.startedAt,
        });
      }
      session!.client.setAskUserHandler((request) => beginAskUser(session!.id, request));
    }

    if (!sessionUIStates.current.has(session!.id)) {
      seedSessionState(session!.id, sessionData.messages as Message[]);
    }
    await switchToSession(session.id);
  }, [cwd, registry, beginAskUser, seedSessionState, switchToSession]);

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
      // Track tokens for current turn (both input and output)
      const turnTokens = (chunk.usage?.inputTokens || 0) + (chunk.usage?.outputTokens || 0);
      setCurrentTurnTokens((prev) => prev + turnTokens);
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
    } else if (chunk.type === 'stopped') {
      // Assistant was stopped mid-processing (e.g., user pressed Ctrl+C)
      // Clear pending entries and trigger queue flush
      const active = registryRef.current.getActiveSession();
      if (active) {
      }
      // Trigger queue flush check (done chunk will follow shortly)
      setQueueFlushTrigger((prev) => prev + 1);
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
        // Load schedules for current session + global and show panel
        listSchedules(cwd, { sessionId: activeSessionId || undefined }).then((schedules) => {
          setSchedulesList(schedules);
          setShowSchedulesPanel(true);
        });
      } else if (chunk.panel === 'skills') {
        // Load skills and show panel
        const client = registry.getActiveSession()?.client;
        if (client) {
          client.getSkills().then((skills: Skill[]) => {
            setSkillsList(skills);
            setShowSkillsPanel(true);
          });
        }
      } else if (chunk.panel === 'assistants') {
        // Handle session actions or show assistants panel/dashboard
        if (chunk.panelValue?.startsWith('session:')) {
          try {
            const payload = JSON.parse(chunk.panelValue.slice('session:'.length));
            if (payload.action === 'list') {
              setShowSessionSelector(true);
            } else if (payload.action === 'new') {
              createAndActivateSession({
                cwd,
                label: payload.label,
                assistantId: payload.agent,
              }).catch((err) => {
                setError(err instanceof Error ? err.message : 'Failed to create session');
              });
            } else if (payload.action === 'assign' && payload.agent) {
              const active = registry.getActiveSession();
              if (active) {
                registry.assignAssistant(active.id, payload.agent);
              }
            } else if (payload.action === 'switch' && payload.number) {
              const allSessions = registry.listSessions();
              const target = allSessions[payload.number - 1];
              if (target) {
                switchToSession(target.id).catch((err) => {
                  setError(err instanceof Error ? err.message : 'Failed to switch session');
                });
              }
            }
          } catch {
            // Invalid payload, show dashboard instead
            setShowAssistantsDashboard(true);
          }
        } else if (chunk.panelValue === 'dashboard') {
          setShowAssistantsDashboard(true);
        } else {
          // Default: show personal assistants panel
          setShowAssistantsPanel(true);
        }
      } else if (chunk.panel === 'identity') {
        // Show identity management panel
        const panelValue = chunk.panelValue?.trim();
        if (panelValue) {
          if (panelValue.startsWith('edit:')) {
            const id = panelValue.slice('edit:'.length).trim();
            setIdentityPanelIntent(id ? { id, mode: 'edit' } : null);
          } else if (panelValue.startsWith('detail:')) {
            const id = panelValue.slice('detail:'.length).trim();
            setIdentityPanelIntent(id ? { id, mode: 'detail' } : null);
          } else {
            setIdentityPanelIntent({ id: panelValue, mode: 'detail' });
          }
        } else {
          setIdentityPanelIntent(null);
        }
        setShowIdentityPanel(true);
      } else if (chunk.panel === 'memory') {
        setMemoryError(null);
        setShowMemoryPanel(true);
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
      } else if (chunk.panel === 'webhooks') {
        setShowWebhooksPanel(true);
      } else if (chunk.panel === 'channels') {
        setShowChannelsPanel(true);
      } else if (chunk.panel === 'people') {
        setShowPeoplePanel(true);
      } else if (chunk.panel === 'telephony') {
        setShowTelephonyPanel(true);
      } else if (chunk.panel === 'orders') {
        setShowOrdersPanel(true);
      } else if (chunk.panel === 'setup') {
        setShowOnboardingPanel(true);
      } else if (chunk.panel === 'messages') {
        // Load messages and inbox data, then show unified panel
        const messagesManager = registry.getActiveSession()?.client.getMessagesManager?.();
        const inboxManager = registry.getActiveSession()?.client.getInboxManager?.();

        // Load assistant messages
        if (messagesManager) {
          messagesManager.list({ limit: 50 }).then((msgs: Array<{
            id: string;
            threadId: string;
            fromAssistantId: string;
            fromAssistantName: string;
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
              fromAssistantId: m.fromAssistantId,
              fromAssistantName: m.fromAssistantName,
              subject: m.subject,
              preview: m.preview,
              body: m.body,
              priority: m.priority as 'low' | 'normal' | 'high' | 'urgent',
              status: m.status as 'unread' | 'read' | 'archived' | 'injected',
              createdAt: m.createdAt,
              replyCount: m.replyCount,
            })));
            setMessagesPanelError(null);
          }).catch((err: Error) => {
            setMessagesPanelError(err instanceof Error ? err.message : String(err));
          });
        } else {
          setMessagesPanelError(null);
        }

        // Load inbox emails
        if (inboxManager) {
          setInboxEnabled(true);
          inboxManager.list({ limit: 50 }).then((emails: EmailListItem[]) => {
            setInboxEmails(emails);
            setInboxError(null);
          }).catch((err: Error) => {
            setInboxError(err instanceof Error ? err.message : String(err));
          });
        } else {
          setInboxEnabled(false);
        }

        setShowMessagesPanel(true);
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
      } else if (chunk.panel === 'projects') {
        // Load projects and show panel
        listProjects(cwd).then((projects) => {
          const activeId = registry.getActiveSession()?.client.getActiveProjectId?.();
          setProjectsList(projects);
          setActiveProjectId(activeId || undefined);
          setShowProjectsPanel(true);
        });
      } else if (chunk.panel === 'plans') {
        // Load active project's plans and show panel
        const activeId = registry.getActiveSession()?.client.getActiveProjectId?.();
        if (activeId) {
          readProject(cwd, activeId).then((project) => {
            if (project) {
              setPlansProject(project);
              setShowPlansPanel(true);
            }
          });
        } else {
          // No active project, show projects panel instead
          listProjects(cwd).then((projects) => {
            setProjectsList(projects);
            setActiveProjectId(undefined);
            setShowProjectsPanel(true);
          });
        }
      } else if (chunk.panel === 'wallet') {
        // Load wallet cards and show panel
        const walletManager = registry.getActiveSession()?.client.getWalletManager?.();
        if (walletManager) {
          walletManager.list().then((cards: Array<{ id: string; name: string; last4: string; brand?: string; expiryMonth?: number; expiryYear?: number; isDefault?: boolean; createdAt?: string }>) => {
            setWalletCards(cards);
            setWalletError(null);
            setShowWalletPanel(true);
          }).catch((err: Error) => {
            setWalletError(err instanceof Error ? err.message : String(err));
            setShowWalletPanel(true);
          });
        } else {
          setWalletError('Wallet not enabled. Configure wallet in config.json.');
          setShowWalletPanel(true);
        }
      } else if (chunk.panel === 'secrets') {
        // Load secrets and show panel
        const secretsManager = registry.getActiveSession()?.client.getSecretsManager?.();
        if (secretsManager) {
          secretsManager.list('all').then((secrets: Array<{ name: string; scope: 'global' | 'assistant'; createdAt?: string; updatedAt?: string }>) => {
            setSecretsList(secrets);
            setSecretsError(null);
            setShowSecretsPanel(true);
          }).catch((err: Error) => {
            setSecretsError(err instanceof Error ? err.message : String(err));
            setShowSecretsPanel(true);
          });
        } else {
          setSecretsError('Secrets not enabled. Configure secrets in config.json.');
          setShowSecretsPanel(true);
        }
      } else if (chunk.panel === 'inbox') {
        // /inbox alias → open messages panel (with inbox tab active via panelValue)
        const messagesManager = registry.getActiveSession()?.client.getMessagesManager?.();
        const inboxManager = registry.getActiveSession()?.client.getInboxManager?.();

        if (messagesManager) {
          messagesManager.list({ limit: 50 }).then((msgs: Array<{
            id: string;
            threadId: string;
            fromAssistantId: string;
            fromAssistantName: string;
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
              fromAssistantId: m.fromAssistantId,
              fromAssistantName: m.fromAssistantName,
              subject: m.subject,
              preview: m.preview,
              body: m.body,
              priority: m.priority as 'low' | 'normal' | 'high' | 'urgent',
              status: m.status as 'unread' | 'read' | 'archived' | 'injected',
              createdAt: m.createdAt,
              replyCount: m.replyCount,
            })));
            setMessagesPanelError(null);
          }).catch((err: Error) => {
            setMessagesPanelError(err instanceof Error ? err.message : String(err));
          });
        }

        if (inboxManager) {
          setInboxEnabled(true);
          inboxManager.list({ limit: 50 }).then((emails: EmailListItem[]) => {
            setInboxEmails(emails);
            setInboxError(null);
          }).catch((err: Error) => {
            setInboxError(err instanceof Error ? err.message : String(err));
          });
        } else {
          setInboxEnabled(false);
        }

        setShowMessagesPanel(true);
      } else if (chunk.panel === 'swarm') {
        setShowSwarmPanel(true);
      } else if (chunk.panel === 'workspace') {
        // Load workspaces and show panel
        import('@hasna/assistants-core').then(({ SharedWorkspaceManager }) => {
          const mgr = new SharedWorkspaceManager();
          const workspaces = mgr.list(true);
          setWorkspacesList(workspaces);
          setShowWorkspacePanel(true);
        });
      } else if (chunk.panel === 'resume') {
        const mode = chunk.panelValue === 'all' ? 'all' : 'cwd';
        setResumeFilter(mode);
        setResumeSessions(SessionStorage.listAllSessions());
        setShowResumePanel(true);
      } else if (chunk.panel === 'heartbeat') {
        const sessionId = activeSessionId || registry.getActiveSession()?.id;
        if (sessionId) {
          readHeartbeatHistoryBySession(sessionId, {
            historyPath: currentConfig?.heartbeat?.historyPath,
            order: 'desc',
          }).then((runs) => {
            setHeartbeatRuns(runs);
            setShowHeartbeatPanel(true);
          });
        } else {
          setHeartbeatRuns([]);
          setShowHeartbeatPanel(true);
        }
      } else if (chunk.panel === 'logs') {
        setShowLogsPanel(true);
      }
    }
  }, [
    registry,
    exit,
    finalizeResponse,
    resetTurnState,
    cwd,
    activeSessionId,
    currentConfig,
    createAndActivateSession,
    switchToSession,
  ]);

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

  const handleOnboardingComplete = useCallback(async (result: OnboardingResult) => {
    const { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } = await import('fs');

    // 1. Save API key to ~/.secrets
    const secretsPath = join(homedir(), '.secrets');
    const keyExport = `export ANTHROPIC_API_KEY="${result.apiKey}"`;
    if (existsSync(secretsPath)) {
      const content = readFileSync(secretsPath, 'utf-8');
      if (content.includes('ANTHROPIC_API_KEY')) {
        // Replace existing line
        const updated = content.replace(/^export ANTHROPIC_API_KEY=.*$/m, keyExport);
        writeFileSync(secretsPath, updated, 'utf-8');
      } else {
        appendFileSync(secretsPath, '\n' + keyExport + '\n', 'utf-8');
      }
    } else {
      writeFileSync(secretsPath, keyExport + '\n', { mode: 0o600 });
    }

    // Save additional connector keys to ~/.secrets
    for (const [name, key] of Object.entries(result.connectorKeys)) {
      const envName = `${name.toUpperCase()}_API_KEY`;
      const connKeyExport = `export ${envName}="${key}"`;
      const content = readFileSync(secretsPath, 'utf-8');
      if (content.includes(envName)) {
        const updated = content.replace(new RegExp(`^export ${envName}=.*$`, 'm'), connKeyExport);
        writeFileSync(secretsPath, updated, 'utf-8');
      } else {
        appendFileSync(secretsPath, connKeyExport + '\n', 'utf-8');
      }
    }

    // 2. Save config to ~/.assistants/config.json
    const configDir = join(homedir(), '.assistants');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    const configPath = join(configDir, 'config.json');
    let existingConfig: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        existingConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      } catch {
        // Start fresh if corrupt
      }
    }
    const newConfig = {
      ...existingConfig,
      onboardingCompleted: true,
      llm: {
        provider: 'anthropic',
        model: result.model,
        apiKey: result.apiKey,
      },
      connectors: result.connectors.length > 0 ? result.connectors : undefined,
    };
    writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');

    // 3. Set API key in current process
    process.env.ANTHROPIC_API_KEY = result.apiKey;

    // 4. Close panel and re-trigger session init
    setShowOnboardingPanel(false);
    // initStateRef is 'idle', so the useEffect will re-run and create a session
  }, []);

  const handleOnboardingCancel = useCallback(() => {
    setShowOnboardingPanel(false);
    // Let the init effect proceed without onboarding
  }, []);

  // Initialize first session
  useEffect(() => {
    // Only skip if initialization completed successfully
    // Allow retry if we were interrupted (state is still 'idle' or was reset to 'idle')
    if (initStateRef.current === 'done') return;

    // If already pending, another instance is running
    if (initStateRef.current === 'pending') return;

    // If showing recovery panel or onboarding, wait for user decision
    if (showRecoveryPanel) return;
    if (showOnboardingPanel) return;

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

        // Check for first-run onboarding
        try {
          const configPath = join(homedir(), '.assistants', 'config.json');
          const { existsSync, readFileSync } = await import('fs');
          let needsOnboarding = false;
          if (!existsSync(configPath)) {
            needsOnboarding = true;
          } else {
            try {
              const raw = readFileSync(configPath, 'utf-8');
              const parsed = JSON.parse(raw);
              if (!parsed.onboardingCompleted) {
                needsOnboarding = true;
              }
            } catch {
              needsOnboarding = true;
            }
          }
          if (needsOnboarding) {
            setShowOnboardingPanel(true);
            initStateRef.current = 'idle';
            setIsInitializing(false);
            return;
          }
        } catch {
          // If checking fails, proceed without onboarding
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
  }, [cwd, registry, showRecoveryPanel, showOnboardingPanel, recoverableSessions, createSessionFromRecovery]);

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
    pendingSendsRef.current.push({ id: nextMessage.id, sessionId: activeSessionId, mode: 'queued' });
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

  const refreshIdentitiesList = useCallback(() => {
    const manager = activeSession?.client.getIdentityManager?.();
    setIdentitiesList(manager?.listIdentities() ?? []);
  }, [activeSession]);

  useEffect(() => {
    if (!showIdentityPanel) return;
    refreshIdentitiesList();
  }, [showIdentityPanel, refreshIdentitiesList]);

  const refreshMemoryList = useCallback(async () => {
    const manager = activeSession?.client.getMemoryManager?.();
    if (!manager) {
      setMemoryError('Memory system not available. Enable it in config.');
      setMemoryList([]);
      setMemoryStats(null);
      return;
    }
    try {
      const result = await manager.query({ limit: 200, orderBy: 'updated', orderDir: 'desc' });
      setMemoryList(result.memories);
      setMemoryStats(await manager.getStats());
      setMemoryError(null);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : String(err));
    }
  }, [activeSession]);

  useEffect(() => {
    if (!showMemoryPanel) return;
    void refreshMemoryList();
  }, [showMemoryPanel, refreshMemoryList]);

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
  const listenHints = useMemo(() => {
    if (!isListening) return [];
    return ['listening...', 'pause 3s to send', '[ctrl+l] stop'];
  }, [isListening]);

  const pttStatus = pttTranscribing ? 'transcribing' as const : pttRecording ? 'recording' as const : null;

  // Show welcome banner only when no messages
  const showWelcome = messages.length === 0 && !isProcessing;

  const renderWidth = columns ? Math.max(1, columns - 2) : undefined;
  const wrapChars = renderWidth ?? MESSAGE_WRAP_CHARS;

  const displayMessages = useMemo(() => {
    const result: ReturnType<typeof buildDisplayMessages> = [];

    for (const msg of messages) {
      // Use cached rendering if available to keep keys stable
      const cached = cachedDisplayMessagesRef.current.get(msg.id);
      if (cached && renderedMessageIdsRef.current.has(msg.id)) {
        result.push(...cached);
        continue;
      }

      // Build display for this message
      const msgDisplay = buildDisplayMessages([msg], MESSAGE_CHUNK_LINES, wrapChars, { maxWidth: renderWidth });

      // Cache the result
      cachedDisplayMessagesRef.current.set(msg.id, msgDisplay);
      renderedMessageIdsRef.current.add(msg.id);

      result.push(...msgDisplay);
    }

    return result;
  }, [messages, wrapChars, renderWidth]);

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
  const listeningDraftMessages = useMemo(() => {
    if (!isListening && !listeningDraft.trim()) return [];
    const content = listeningDraft.trim() || 'Listening...';
    const draftMessage: Message = {
      id: 'listening-draft',
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    return buildDisplayMessages([draftMessage], MESSAGE_CHUNK_LINES, wrapChars, { maxWidth: renderWidth });
  }, [isListening, listeningDraft, wrapChars, renderWidth]);
  const activityTrim = useMemo(() => {
    const activityBudget = Math.max(4, dynamicBudget - streamingLineCount);
    return trimActivityLogByLines(activityLog, wrapChars, renderWidth, activityBudget);
  }, [activityLog, wrapChars, renderWidth, dynamicBudget, streamingLineCount]);
  const hasListeningDraft = listeningDraftMessages.length > 0;
  const combinedStreamingMessages = hasListeningDraft
    ? [...streamingMessages, ...listeningDraftMessages]
    : streamingMessages;
  const showDynamicPanel = isProcessing || hasListeningDraft || activityTrim.entries.length > 0;

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

    await switchToSession(sessionId);
  }, [switchToSession]);

  // Handle new session creation
  const handleNewSession = useCallback(async () => {
    // Close selector IMMEDIATELY - don't wait for async operations
    setShowSessionSelector(false);

    try {
      await createAndActivateSession({ cwd });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  }, [cwd, createAndActivateSession]);


  // Handle keyboard shortcuts (inactive when session selector is shown)
  useInput((input, key) => {
    if (isListeningRef.current && key.ctrl && input === 'l') {
      stopListening();
      return;
    }
    // Ctrl+R: push-to-talk recording toggle
    if (key.ctrl && input === 'r') {
      togglePushToTalk();
      return;
    }
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
      const sessionProcessing = activeSession?.isProcessing ?? false;
      if ((isProcessing || hasPendingTools || sessionProcessing || currentToolCall) && activeSession) {
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
      const sessionProcessing = activeSession?.isProcessing ?? false;
      if ((isProcessing || hasPendingTools || sessionProcessing || currentToolCall) && activeSession) {
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

    // Ctrl+A: show assistants dashboard
    if (key.ctrl && input === 'a') {
      setShowAssistantsDashboard(true);
      return;
    }
    // Ctrl+B: show budget panel
    if (key.ctrl && input === 'b') {
      if (!budgetTrackerRef.current) {
        budgetTrackerRef.current = new BudgetTracker(activeSessionId || 'default');
      }
      const bConfig = budgetTrackerRef.current.getConfig();
      const bSessionStatus = budgetTrackerRef.current.checkBudget('session');
      const bSwarmStatus = budgetTrackerRef.current.checkBudget('swarm');
      setBudgetConfig(bConfig);
      setSessionBudgetStatus(bSessionStatus);
      setSwarmBudgetStatus(bSwarmStatus);
      setShowBudgetPanel(true);
      return;
    }
    // Ctrl+M: show messages panel
    if (key.ctrl && input === 'm') {
      const messagesManager = registry.getActiveSession()?.client.getMessagesManager?.();
      if (messagesManager) {
        messagesManager.list({ limit: 50 }).then((msgs: any[]) => {
          setMessagesList(msgs.map((m: any) => ({
            id: m.id,
            threadId: m.threadId,
            fromAssistantId: m.fromAssistantId,
            fromAssistantName: m.fromAssistantName,
            subject: m.subject,
            preview: m.preview,
            body: m.body,
            priority: m.priority,
            status: m.status,
            createdAt: m.createdAt,
            replyCount: m.replyCount,
          })));
          setMessagesPanelError(null);
          setShowMessagesPanel(true);
        }).catch(() => {
          setShowMessagesPanel(true);
        });
      } else {
        setShowMessagesPanel(true);
      }
      return;
    }

    // Native terminal scrolling is used - scroll with terminal's scrollback
  }, { isActive: !showSessionSelector && !isPanelOpen });


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

      // Shell passthrough: !<command> runs locally and reports output to the assistant
      if (trimmedInput.startsWith('!')) {
        const raw = trimmedInput.slice(1).trim();
        const shellCommand = raw.startsWith('[') && raw.endsWith(']')
          ? raw.slice(1, -1).trim()
          : raw;
        if (!shellCommand) {
          setError('Usage: !<command>');
          return;
        }
        try {
          const shellCwd = activeSession?.cwd || cwd;
          const result = await runShellCommand(shellCommand, shellCwd);
          const payload = formatShellResult(shellCommand, result);
          return handleSubmit(payload, mode);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
      }

      // Check for /listen command (persistent dictation mode)
      if (trimmedInput.startsWith('/listen')) {
        const arg = trimmedInput.slice(7).trim().toLowerCase();
        if (arg === 'stop' || arg === 'off') {
          stopListening();
          return;
        }
        if (listenLoopRef.current.active) {
          stopListening();
          return;
        }
        startListening();
        return;
      }

      // Check for /exit command
      if (trimmedInput === '/exit') {
        registry.closeAll();
        exit();
        return;
      }

      // Intercept panel commands at terminal level for reliability.
      // These commands open interactive panels and should bypass the LLM entirely.
      const panelMatch = trimmedInput.match(/^\/(\S+)(?:\s+(.*))?$/);
      if (panelMatch && activeSession) {
        const cmdName = panelMatch[1].toLowerCase();
        const cmdArgs = (panelMatch[2] || '').trim();

        // /connectors (no args) → open panel
        if (cmdName === 'connectors' && !cmdArgs) {
          setConnectorsPanelInitial(undefined);
          setShowConnectorsPanel(true);
          return;
        }

        // /hooks (no args) → open panel
        if (cmdName === 'hooks' && !cmdArgs) {
          if (!hookStoreRef.current) {
            hookStoreRef.current = new HookStore(cwd);
          }
          const hooks = hookStoreRef.current.loadAll();
          setHooksConfig(hooks);
          setShowHooksPanel(true);
          return;
        }

        // /config (no args) → open panel
        if (cmdName === 'config' && !cmdArgs) {
          loadConfigFiles();
          setShowConfigPanel(true);
          return;
        }

        // /identity (no args) → open panel
        if (cmdName === 'identity' && !cmdArgs) {
          setIdentityPanelIntent(null);
          setShowIdentityPanel(true);
          return;
        }

        // /onboarding (no args) → rerun onboarding flow
        if (cmdName === 'onboarding' && !cmdArgs) {
          setShowOnboardingPanel(true);
          return;
        }

        // /memory (no args) → open panel
        if (cmdName === 'memory' && !cmdArgs) {
          setMemoryError(null);
          setShowMemoryPanel(true);
          return;
        }

        // /guardrails (no args) → open panel
        if (cmdName === 'guardrails' && !cmdArgs) {
          if (!guardrailsStoreRef.current) {
            guardrailsStoreRef.current = new GuardrailsStore(cwd);
          }
          const config = guardrailsStoreRef.current.loadAll();
          const policies = guardrailsStoreRef.current.listPolicies();
          setGuardrailsConfig(config);
          setGuardrailsPolicies(policies);
          setShowGuardrailsPanel(true);
          return;
        }

        // /budget (no args) → open panel
        if (cmdName === 'budget' && !cmdArgs) {
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
          return;
        }

        // /swarm (no args) → open panel
        if (cmdName === 'swarm' && !cmdArgs) {
          setShowSwarmPanel(true);
          return;
        }

        // /tasks (no args) → open panel
        if (cmdName === 'tasks' && !cmdArgs) {
          getTasks(cwd).then((tasks) => {
            setTasksList(tasks);
            isPaused(cwd).then((paused) => {
              setTasksPaused(paused);
              setShowTasksPanel(true);
            });
          });
          return;
        }

        // /schedules (no args) → open panel
        if (cmdName === 'schedules' && !cmdArgs) {
          listSchedules(cwd, { sessionId: activeSessionId || undefined }).then((schedules) => {
            setSchedulesList(schedules);
            setShowSchedulesPanel(true);
          });
          return;
        }

        // /skills (no args) → open panel
        if ((cmdName === 'skills' || cmdName === 'skill') && !cmdArgs) {
          const client = registry.getActiveSession()?.client;
          if (client) {
            client.getSkills().then((skills: Skill[]) => {
              setSkillsList(skills);
              setShowSkillsPanel(true);
            });
          }
          return;
        }

        // /assistants update → run CLI update
        if (cmdName === 'assistants' && cmdArgs) {
          const [subcommand] = cmdArgs.split(/\s+/);
          if (subcommand?.toLowerCase() === 'update') {
            const shellCommand = 'bun install -g @hasna/assistants';
            const shellCwd = activeSession?.cwd || cwd;
            setError(null);
            try {
              const result = await runShellCommand(shellCommand, shellCwd);
              setMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: 'assistant',
                  content: formatShellResult(shellCommand, result),
                  timestamp: now(),
                },
              ]);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              setError(message);
            }
            return;
          }
        }

        // /assistants (no args) → open panel or dashboard
        if (cmdName === 'assistants' && !cmdArgs) {
          // Show the dashboard view
          setShowAssistantsPanel(true);
          return;
        }

        // /projects (no args) → open panel
        if (cmdName === 'projects' && !cmdArgs) {
          listProjects(cwd).then((projects) => {
            const activeId = registry.getActiveSession()?.client.getActiveProjectId?.();
            setProjectsList(projects);
            setActiveProjectId(activeId || undefined);
            setShowProjectsPanel(true);
          });
          return;
        }

        // /plans (no args) → open panel
        if (cmdName === 'plans' && !cmdArgs) {
          const activeId = registry.getActiveSession()?.client.getActiveProjectId?.();
          if (activeId) {
            readProject(cwd, activeId).then((project) => {
              if (project) {
                setPlansProject(project);
                setShowPlansPanel(true);
              }
            });
          } else {
            listProjects(cwd).then((projects) => {
              setProjectsList(projects);
              setActiveProjectId(undefined);
              setShowProjectsPanel(true);
            });
          }
          return;
        }

        // /messages or /inbox (no args) → open unified messages panel
        if ((cmdName === 'messages' || cmdName === 'inbox') && !cmdArgs) {
          const messagesManager = registry.getActiveSession()?.client.getMessagesManager?.();
          const inboxMgr = registry.getActiveSession()?.client.getInboxManager?.();

          if (messagesManager) {
            messagesManager.list({ limit: 50 }).then((msgs: any[]) => {
              setMessagesList(msgs.map((m: any) => ({
                id: m.id,
                threadId: m.threadId,
                fromAssistantId: m.fromAssistantId,
                fromAssistantName: m.fromAssistantName,
                subject: m.subject,
                preview: m.preview,
                body: m.body,
                priority: m.priority as 'low' | 'normal' | 'high' | 'urgent',
                status: m.status as 'unread' | 'read' | 'archived' | 'injected',
                createdAt: m.createdAt,
                replyCount: m.replyCount,
              })));
              setMessagesPanelError(null);
            }).catch((err: Error) => {
              setMessagesPanelError(err instanceof Error ? err.message : String(err));
            });
          } else {
            setMessagesPanelError(null);
          }

          if (inboxMgr) {
            setInboxEnabled(true);
            inboxMgr.list({ limit: 50 }).then((emails: EmailListItem[]) => {
              setInboxEmails(emails);
              setInboxError(null);
            }).catch((err: Error) => {
              setInboxError(err instanceof Error ? err.message : String(err));
            });
          } else {
            setInboxEnabled(false);
          }

          setShowMessagesPanel(true);
          return;
        }

        // /wallet (no args) → open panel
        if (cmdName === 'wallet' && !cmdArgs) {
          const walletManager = registry.getActiveSession()?.client.getWalletManager?.();
          if (walletManager) {
            walletManager.list().then((cards: any[]) => {
              setWalletCards(cards);
              setWalletError(null);
              setShowWalletPanel(true);
            }).catch((err: Error) => {
              setWalletError(err instanceof Error ? err.message : String(err));
              setShowWalletPanel(true);
            });
          } else {
            setWalletError('Wallet not enabled. Configure wallet in config.json.');
            setShowWalletPanel(true);
          }
          return;
        }

        // /secrets (no args) → open panel
        if (cmdName === 'secrets' && !cmdArgs) {
          const secretsManager = registry.getActiveSession()?.client.getSecretsManager?.();
          if (secretsManager) {
            secretsManager.list('all').then((secrets: any[]) => {
              setSecretsList(secrets);
              setSecretsError(null);
              setShowSecretsPanel(true);
            }).catch((err: Error) => {
              setSecretsError(err instanceof Error ? err.message : String(err));
              setShowSecretsPanel(true);
            });
          } else {
            setSecretsError('Secrets not enabled. Configure secrets in config.json.');
            setShowSecretsPanel(true);
          }
          return;
        }
      }

      // Check for /session command
      if (trimmedInput.startsWith('/session')) {
        const arg = trimmedInput.slice(8).trim();
        const sessionParts = arg.split(/\s+/);
        const sessionSub = sessionParts[0]?.toLowerCase() || '';

        if (sessionSub === 'new') {
          // Parse --agent flag
          const agentIdx = sessionParts.indexOf('--agent');
          let label: string | undefined;
          let agentId: string | undefined;

          if (agentIdx !== -1 && sessionParts[agentIdx + 1]) {
            agentId = sessionParts[agentIdx + 1];
            const labelParts = sessionParts.slice(1, agentIdx);
            if (labelParts.length > 0) label = labelParts.join(' ');
          } else {
            const labelParts = sessionParts.slice(1);
            if (labelParts.length > 0) label = labelParts.join(' ');
          }

          await createAndActivateSession({
            cwd,
            label,
            assistantId: agentId,
          });
          return;
        }

        if (sessionSub === 'assign') {
          const agentName = sessionParts.slice(1).join(' ').trim();
          if (agentName && activeSession) {
            registry.assignAssistant(activeSession.id, agentName);
          }
          return;
        }

        if (sessionSub === 'help') {
          // Let it fall through to the assistant loop for help text
        } else {
          const num = parseInt(sessionSub, 10);
          if (!isNaN(num) && num > 0 && num <= sessions.length) {
            await handleSessionSwitch(sessions[num - 1].id);
            return;
          }

          // No arg or 'list' - show session selector
          setShowSessionSelector(true);
          return;
        }
      }

      // Handle /clear and /new entirely at terminal level for reliability.
      const isClearCommand = trimmedInput === '/clear' || trimmedInput === '/new';

      if (isClearCommand) {
        // Stop any ongoing processing
        if (isProcessing) {
          activeSession.client.stop();
          const finalized = finalizeResponse('interrupted');
          if (finalized) {
            skipNextDoneRef.current = true;
          }
          resetTurnState();
          setIsProcessing(false);
          isProcessingRef.current = false;
          registry.setProcessing(activeSession.id, false);
          setQueueFlushTrigger((prev) => prev + 1);
          await new Promise((r) => setTimeout(r, 100));
        }

        // Clear UI state
        setMessageQueue((prev) => prev.filter((msg) => msg.sessionId !== activeSession.id));
        setInlinePending((prev) => prev.filter((msg) => msg.sessionId !== activeSession.id));
        pendingSendsRef.current = pendingSendsRef.current.filter(
          (entry) => entry.sessionId !== activeSession.id
        );
        setActivityLog([]);
        activityLogRef.current = [];
        setLastWorkedFor(undefined);
        setError(null);
        setCurrentResponse('');
        responseRef.current = '';
        toolCallsRef.current = [];
        toolResultsRef.current = [];

        clearSessionWindow();

        // Clear conversation on the client side (resets context, tokens, etc.)
        activeSession.client.clearConversation();

        // Show confirmation message, then clear all messages
        const confirmText = trimmedInput === '/new'
          ? 'Starting new conversation.'
          : 'Conversation cleared. Starting fresh.';
        setMessages([{
          id: generateId(),
          role: 'assistant',
          content: confirmText,
          timestamp: now(),
        }]);

        // Update session UI state cache
        sessionUIStates.current.set(activeSession.id, {
          messages: [],
          currentResponse: '',
          activityLog: [],
          toolCalls: [],
          toolResults: [],
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, maxContextTokens: tokenUsage?.maxContextTokens || 200000 },
          energyState,
          voiceState,
          heartbeatState,
          identityInfo,
          processingStartTime: undefined,
          currentTurnTokens: 0,
          error: null,
          lastWorkedFor: undefined,
        });

        // Reset token usage display
        setTokenUsage({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          maxContextTokens: tokenUsage?.maxContextTokens || 200000,
        });

        return;
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
      const submitStartNow = Date.now();
      setProcessingStartTime(submitStartNow);
      processingStartTimeRef.current = submitStartNow; // Sync ref immediately for synchronous access
      setCurrentTurnTokens(0);
      setIsProcessing(true);
      isProcessingRef.current = true;

      // Mark session as processing
      registry.setProcessing(activeSession.id, true);

      // Send to assistant
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
      createAndActivateSession,
      finalizeResponse,
      resetTurnState,
      activeSessionId,
      submitAskAnswer,
      clearPendingSend,
      startListening,
      stopListening,
    ]
  );

  useEffect(() => {
    sendListenMessageRef.current = (text: string) => {
      const mode = isProcessingRef.current ? 'inline' : 'normal';
      void handleSubmit(text, mode);
    };
  }, [handleSubmit]);

  if (isInitializing && !showRecoveryPanel && !showOnboardingPanel) {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Initializing..." />
      </Box>
    );
  }

  // Show onboarding panel for first-run setup
  if (showOnboardingPanel) {
    // Get existing API key from env or config
    const existingKey = process.env.ANTHROPIC_API_KEY || undefined;
    // Get discovered connectors from connector bridge
    const discovered = connectorBridgeRef.current?.fastDiscover() || [];
    const discoveredNames = discovered.map((c: Connector) => c.name);

    return (
      <OnboardingPanel
        onComplete={handleOnboardingComplete}
        onCancel={handleOnboardingCancel}
        existingApiKey={existingKey}
        discoveredConnectors={discoveredNames}
      />
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

    const handleLoadCommands = async (connectorName: string) => {
      if (!connectorBridgeRef.current) {
        return null;
      }
      // Run full discovery for this specific connector
      const discovered = await connectorBridgeRef.current.discover([connectorName]);
      const connector = discovered.find((c) => c.name === connectorName);
      if (connector) {
        // Update the connectors list with the discovered connector
        setConnectors((prev) => {
          const updated = prev.map((c) => c.name === connectorName ? connector : c);
          return updated;
        });
      }
      return connector || null;
    };

    return (
      <Box flexDirection="column" padding={1}>
        <ConnectorsPanel
          connectors={connectors}
          initialConnector={connectorsPanelInitial}
          onCheckAuth={handleCheckAuth}
          onGetCommandHelp={handleGetCommandHelp}
          onLoadCommands={handleLoadCommands}
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
        // Send the task to the assistant
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

  // Show skills panel
  if (showSkillsPanel) {
    const activeClient = registry.getActiveSession()?.client;

    const handleSkillExecute = (name: string) => {
      setShowSkillsPanel(false);
      if (activeClient) {
        activeClient.send(`/${name}`);
      }
    };

    const handleSkillCreate = async (options: CreateSkillOptions) => {
      const result = await createSkill(options);
      // Refresh skills in the assistant loop
      if (activeClient) {
        await activeClient.refreshSkills();
      }
      return result;
    };

    const handleSkillDelete = async (name: string, filePath: string) => {
      await deleteSkill(filePath);
      // Remove from loader and refresh
      const skillLoader = activeClient?.getSkillLoader();
      if (skillLoader) {
        skillLoader.removeSkill(name);
      }
    };

    const handleSkillRefresh = async () => {
      if (activeClient) {
        const refreshed = await activeClient.refreshSkills();
        setSkillsList(refreshed);
        return refreshed;
      }
      return skillsList;
    };

    const handleSkillEnsureContent = async (name: string) => {
      const skillLoader = activeClient?.getSkillLoader();
      if (skillLoader && typeof skillLoader.ensureSkillContent === 'function') {
        return skillLoader.ensureSkillContent(name);
      }
      return null;
    };

    return (
      <Box flexDirection="column" padding={1}>
        <SkillsPanel
          skills={skillsList}
          onExecute={handleSkillExecute}
          onCreate={handleSkillCreate}
          onDelete={handleSkillDelete}
          onRefresh={handleSkillRefresh}
          onEnsureContent={handleSkillEnsureContent}
          onClose={() => setShowSkillsPanel(false)}
          cwd={cwd}
        />
      </Box>
    );
  }

  // Show schedules panel
  if (showSchedulesPanel) {
    // Session-scoped schedule list options
    const scheduleListOpts = { sessionId: activeSessionId || undefined };

    const handleSchedulePause = async (id: string) => {
      await updateSchedule(cwd, id, (schedule) => ({
        ...schedule,
        status: 'paused',
        updatedAt: Date.now(),
      }));
      setSchedulesList(await listSchedules(cwd, scheduleListOpts));
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
      setSchedulesList(await listSchedules(cwd, scheduleListOpts));
    };

    const handleScheduleDelete = async (id: string) => {
      // Optimistic removal: remove from UI immediately
      setSchedulesList((prev) => prev.filter((s) => s.id !== id));
      // Then delete from disk and refresh
      await deleteSchedule(cwd, id);
      const refreshed = await listSchedules(cwd, scheduleListOpts);
      setSchedulesList(refreshed);
    };

    const handleScheduleRun = async (id: string) => {
      const schedule = schedulesList.find((s) => s.id === id);
      if (schedule && activeSession) {
        // Execute based on action type
        const actionType = schedule.actionType || 'command';
        if (actionType === 'message' && schedule.message) {
          // Send the message content
          await activeSession.client.send(schedule.message);
        } else {
          // Execute the command
          await activeSession.client.send(schedule.command);
        }
      }
    };

    const handleScheduleRefresh = async () => {
      setSchedulesList(await listSchedules(cwd, scheduleListOpts));
    };

    const handleScheduleCreate = async (schedule: Omit<ScheduledCommand, 'id' | 'createdAt' | 'updatedAt' | 'nextRunAt'>) => {
      const now = Date.now();
      const fullSchedule: ScheduledCommand = {
        ...schedule,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      };
      fullSchedule.nextRunAt = computeNextRun(fullSchedule, now);
      if (!fullSchedule.nextRunAt) {
        throw new Error('Unable to compute next run time. Check your schedule configuration.');
      }
      if (fullSchedule.schedule.kind === 'once' && fullSchedule.nextRunAt <= now) {
        throw new Error('Scheduled time must be in the future.');
      }
      await saveSchedule(cwd, fullSchedule);
      setSchedulesList(await listSchedules(cwd, scheduleListOpts));
    };

    return (
      <Box flexDirection="column" padding={1}>
        <SchedulesPanel
          schedules={schedulesList}
          sessionId={activeSessionId || 'default'}
          onPause={handleSchedulePause}
          onResume={handleScheduleResume}
          onDelete={handleScheduleDelete}
          onRun={handleScheduleRun}
          onCreate={handleScheduleCreate}
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
    const ensureAssistantManager = () => {
      if (assistantManager) return assistantManager;
      const err = new Error('Assistant manager not available');
      setAssistantError(err.message);
      throw err;
    };

    const handleAssistantSelect = async (assistantId: string) => {
      setAssistantError(null);
      try {
        const manager = ensureAssistantManager();
        await manager.switchAssistant(assistantId);
        // Refresh identity context after switching
        await activeSession?.client.refreshIdentityContext?.();
        setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
        setAssistantsRefreshKey((k) => k + 1);
        setShowAssistantsPanel(false);
      } catch (err) {
        setAssistantError(err instanceof Error ? err.message : 'Failed to switch assistant');
      }
    };

    const handleAssistantCreate = async (options: { name: string; description?: string; settings?: { model?: string; temperature?: number } }) => {
      setAssistantError(null);
      try {
        const manager = ensureAssistantManager();
        await manager.createAssistant(options);
        // Refresh identity context after creation
        await activeSession?.client.refreshIdentityContext?.();
        setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
        // Force refresh of assistants list
        setAssistantsRefreshKey((k) => k + 1);
      } catch (err) {
        setAssistantError(err instanceof Error ? err.message : 'Failed to create assistant');
        throw err; // Re-throw so AssistantsPanel knows creation failed
      }
    };

    const handleAssistantUpdate = async (id: string, updates: Partial<{ name: string; description: string; settings: Record<string, unknown> }>) => {
      setAssistantError(null);
      try {
        const manager = ensureAssistantManager();
        await manager.updateAssistant(id, updates as any);
        // Refresh identity context after update
        await activeSession?.client.refreshIdentityContext?.();
        setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
        // Force refresh of assistants list
        setAssistantsRefreshKey((k) => k + 1);
      } catch (err) {
        setAssistantError(err instanceof Error ? err.message : 'Failed to update assistant');
        throw err; // Re-throw so AssistantsPanel knows update failed
      }
    };

    const handleAssistantDelete = async (assistantId: string) => {
      setAssistantError(null);
      try {
        const manager = ensureAssistantManager();
        await manager.deleteAssistant(assistantId);
        // Refresh identity context after deletion
        await activeSession?.client.refreshIdentityContext?.();
        setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
        // Force refresh of assistants list
        setAssistantsRefreshKey((k) => k + 1);
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

  // Show identity panel
  if (showIdentityPanel) {
    const identityManager = activeSession?.client.getIdentityManager?.();
    const activeIdentity = identityManager?.getActive();
    const templates = listTemplates();

    const ensureIdentityManager = () => {
      if (identityManager) return identityManager;
      const err = new Error('Identity manager not available');
      setIdentityError(err.message);
      throw err;
    };

    const handleIdentitySwitch = async (identityId: string) => {
      setIdentityError(null);
      try {
        const manager = ensureIdentityManager();
        await manager.switchIdentity(identityId);
        await activeSession?.client.refreshIdentityContext?.();
        setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
        refreshIdentitiesList();
      } catch (err) {
        setIdentityError(err instanceof Error ? err.message : 'Failed to switch identity');
      }
    };

    const handleIdentityCreate = async (options: CreateIdentityOptions) => {
      setIdentityError(null);
      try {
        const manager = ensureIdentityManager();
        await manager.createIdentity(options);
        await activeSession?.client.refreshIdentityContext?.();
        setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
        refreshIdentitiesList();
      } catch (err) {
        setIdentityError(err instanceof Error ? err.message : 'Failed to create identity');
        throw err;
      }
    };

    const handleIdentityCreateFromTemplate = async (templateName: string) => {
      setIdentityError(null);
      try {
        const manager = ensureIdentityManager();
        const options = createIdentityFromTemplate(templateName);
        if (options) {
          await manager.createIdentity(options);
          await activeSession?.client.refreshIdentityContext?.();
          setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
          refreshIdentitiesList();
        }
      } catch (err) {
        setIdentityError(err instanceof Error ? err.message : 'Failed to create identity from template');
        throw err;
      }
    };

    const handleIdentityUpdate = async (identityId: string, updates: Partial<CreateIdentityOptions>) => {
      setIdentityError(null);
      try {
        const manager = ensureIdentityManager();
        await manager.updateIdentity(identityId, updates as any);
        await activeSession?.client.refreshIdentityContext?.();
        setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
        refreshIdentitiesList();
      } catch (err) {
        setIdentityError(err instanceof Error ? err.message : 'Failed to update identity');
        throw err;
      }
    };

    const handleIdentitySetDefault = async (identityId: string) => {
      setIdentityError(null);
      try {
        const manager = ensureIdentityManager();
        // Clear default from all other identities
        for (const identity of identitiesList) {
          if (identity.isDefault && identity.id !== identityId) {
            await manager.updateIdentity(identity.id, { isDefault: false });
          }
        }
        await manager.updateIdentity(identityId, { isDefault: true });
        await activeSession?.client.refreshIdentityContext?.();
        setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
        refreshIdentitiesList();
      } catch (err) {
        setIdentityError(err instanceof Error ? err.message : 'Failed to set default identity');
      }
    };

    const handleIdentityDelete = async (identityId: string) => {
      setIdentityError(null);
      try {
        const manager = ensureIdentityManager();
        await manager.deleteIdentity(identityId);
        await activeSession?.client.refreshIdentityContext?.();
        setIdentityInfo(activeSession?.client.getIdentityInfo() ?? undefined);
        refreshIdentitiesList();
      } catch (err) {
        setIdentityError(err instanceof Error ? err.message : 'Failed to delete identity');
        throw err;
      }
    };

    return (
      <Box flexDirection="column" padding={1}>
        <IdentityPanel
          identities={identitiesList}
          activeIdentityId={activeIdentity?.id}
          initialIdentityId={identityPanelIntent?.id}
          initialMode={identityPanelIntent?.mode}
          templates={templates}
          onSwitch={handleIdentitySwitch}
          onCreate={handleIdentityCreate}
          onCreateFromTemplate={handleIdentityCreateFromTemplate}
          onUpdate={handleIdentityUpdate}
          onSetDefault={handleIdentitySetDefault}
          onDelete={handleIdentityDelete}
          onClose={() => {
            setIdentityError(null);
            setIdentityPanelIntent(null);
            setShowIdentityPanel(false);
          }}
          error={identityError}
        />
      </Box>
    );
  }

  // Show memory panel
  if (showMemoryPanel) {
    return (
      <Box flexDirection="column" padding={1}>
        <MemoryPanel
          memories={memoryList}
          stats={memoryStats}
          error={memoryError}
          onRefresh={refreshMemoryList}
          onClose={() => {
            setShowMemoryPanel(false);
            setMemoryError(null);
          }}
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

    const handleAddPolicy = (policy: any) => {
      if (!guardrailsStoreRef.current) {
        guardrailsStoreRef.current = new GuardrailsStore(cwd);
      }
      guardrailsStoreRef.current.addPolicy(policy, 'project');
      const config = guardrailsStoreRef.current.loadAll();
      const policies = guardrailsStoreRef.current.listPolicies();
      setGuardrailsConfig(config);
      setGuardrailsPolicies(policies);
    };

    const handleRemovePolicy = (policyId: string) => {
      if (!guardrailsStoreRef.current) {
        guardrailsStoreRef.current = new GuardrailsStore(cwd);
      }
      guardrailsStoreRef.current.removePolicy(policyId);
      const config = guardrailsStoreRef.current.loadAll();
      const policies = guardrailsStoreRef.current.listPolicies();
      setGuardrailsConfig(config);
      setGuardrailsPolicies(policies);
    };

    const handleUpdatePolicy = (policyId: string, updates: any) => {
      if (!guardrailsStoreRef.current) {
        guardrailsStoreRef.current = new GuardrailsStore(cwd);
      }
      const existing = guardrailsStoreRef.current.getPolicy(policyId);
      if (existing) {
        guardrailsStoreRef.current.removePolicy(policyId);
        const merged = { ...existing.policy, ...updates };
        guardrailsStoreRef.current.addPolicy(merged, existing.location as any);
      }
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
          onAddPolicy={handleAddPolicy}
          onRemovePolicy={handleRemovePolicy}
          onUpdatePolicy={handleUpdatePolicy}
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
          onSetOnExceeded={(action) => {
            if (budgetTrackerRef.current) {
              budgetTrackerRef.current.updateConfig({ onExceeded: action });
              setBudgetConfig(budgetTrackerRef.current.getConfig());
            }
          }}
          onCancel={() => setShowBudgetPanel(false)}
        />
      </Box>
    );
  }

  // Show assistants registry panel
  if (showAssistantsRegistryPanel && registryStats) {
    const handleAssistantsRefresh = () => {
      const assistantRegistry = getGlobalRegistry();
      const assistants = assistantRegistry.list();
      const stats = assistantRegistry.getStats();
      setAssistantsList(assistants);
      setRegistryStats(stats);
    };

    return (
      <Box flexDirection="column" padding={1}>
        <AssistantsRegistryPanel
          assistants={assistantsList}
          stats={registryStats}
          onRefresh={handleAssistantsRefresh}
          onCancel={() => setShowAssistantsRegistryPanel(false)}
        />
      </Box>
    );
  }

  // Show projects panel
  if (showProjectsPanel) {
    const handleProjectSelect = (projectId: string) => {
      const activeSession = registry.getActiveSession();
      activeSession?.client.setActiveProjectId?.(projectId);
      setActiveProjectId(projectId);
      setShowProjectsPanel(false);
    };

    const handleProjectCreate = async (name: string, description?: string) => {
      const project = await createProject(cwd, name, description);
      const projects = await listProjects(cwd);
      setProjectsList(projects);
      // Auto-select the new project
      const activeSession = registry.getActiveSession();
      activeSession?.client.setActiveProjectId?.(project.id);
      setActiveProjectId(project.id);
    };

    const handleProjectDelete = async (projectId: string) => {
      await deleteProject(cwd, projectId);
      const projects = await listProjects(cwd);
      setProjectsList(projects);
      // Clear active project if it was deleted
      if (activeProjectId === projectId) {
        const activeSession = registry.getActiveSession();
        activeSession?.client.setActiveProjectId?.(null);
        setActiveProjectId(undefined);
      }
    };

    const handleViewPlans = (projectId: string) => {
      readProject(cwd, projectId).then((project) => {
        if (project) {
          setPlansProject(project);
          setShowProjectsPanel(false);
          setShowPlansPanel(true);
        }
      });
    };

    return (
      <Box flexDirection="column" padding={1}>
        <ProjectsPanel
          projects={projectsList}
          activeProjectId={activeProjectId}
          onSelect={handleProjectSelect}
          onCreate={handleProjectCreate}
          onDelete={handleProjectDelete}
          onViewPlans={handleViewPlans}
          onCancel={() => setShowProjectsPanel(false)}
        />
      </Box>
    );
  }

  // Show plans panel
  if (showPlansPanel && plansProject) {
    const handleCreatePlan = async (title: string) => {
      const now = Date.now();
      const plan: ProjectPlan = {
        id: `plan-${now}`,
        title,
        createdAt: now,
        updatedAt: now,
        steps: [],
      };
      const updated = await updateProject(cwd, plansProject.id, (current) => ({
        ...current,
        plans: [...current.plans, plan],
        updatedAt: now,
      }));
      if (updated) setPlansProject(updated);
    };

    const handleDeletePlan = async (planId: string) => {
      const now = Date.now();
      const updated = await updateProject(cwd, plansProject.id, (current) => ({
        ...current,
        plans: current.plans.filter((p) => p.id !== planId),
        updatedAt: now,
      }));
      if (updated) setPlansProject(updated);
    };

    const handleAddStep = async (planId: string, text: string) => {
      const now = Date.now();
      const updated = await updateProject(cwd, plansProject.id, (current) => ({
        ...current,
        plans: current.plans.map((p) =>
          p.id === planId
            ? { ...p, steps: [...p.steps, { id: `step-${now}`, text, status: 'todo' as const, createdAt: now, updatedAt: now }], updatedAt: now }
            : p
        ),
        updatedAt: now,
      }));
      if (updated) setPlansProject(updated);
    };

    const handleUpdateStep = async (planId: string, stepId: string, status: PlanStepStatus) => {
      const now = Date.now();
      const updated = await updateProject(cwd, plansProject.id, (current) => ({
        ...current,
        plans: current.plans.map((p) =>
          p.id === planId
            ? { ...p, steps: p.steps.map((s) => (s.id === stepId ? { ...s, status, updatedAt: now } : s)), updatedAt: now }
            : p
        ),
        updatedAt: now,
      }));
      if (updated) setPlansProject(updated);
    };

    const handleRemoveStep = async (planId: string, stepId: string) => {
      const now = Date.now();
      const updated = await updateProject(cwd, plansProject.id, (current) => ({
        ...current,
        plans: current.plans.map((p) =>
          p.id === planId
            ? { ...p, steps: p.steps.filter((s) => s.id !== stepId), updatedAt: now }
            : p
        ),
        updatedAt: now,
      }));
      if (updated) setPlansProject(updated);
    };

    const handleBack = () => {
      setShowPlansPanel(false);
    };

    return (
      <Box flexDirection="column" padding={1}>
        <PlansPanel
          project={plansProject}
          onCreatePlan={handleCreatePlan}
          onDeletePlan={handleDeletePlan}
          onAddStep={handleAddStep}
          onUpdateStep={handleUpdateStep}
          onRemoveStep={handleRemoveStep}
          onBack={handleBack}
          onClose={() => setShowPlansPanel(false)}
        />
      </Box>
    );
  }

  // Show wallet panel
  if (showWalletPanel) {
    const walletManager = activeSession?.client.getWalletManager?.();

    const handleWalletGet = async (cardId: string) => {
      if (!walletManager) throw new Error('Wallet not available');
      const card = await walletManager.get(cardId);
      return card;
    };

    const handleWalletRemove = async (cardId: string) => {
      if (!walletManager) throw new Error('Wallet not available');
      await walletManager.remove(cardId);
      const cards = await walletManager.list();
      setWalletCards(cards);
    };

    return (
      <Box flexDirection="column" padding={1}>
        <WalletPanel
          cards={walletCards}
          onGet={handleWalletGet}
          onRemove={handleWalletRemove}
          onClose={() => setShowWalletPanel(false)}
          error={walletError}
        />
      </Box>
    );
  }

  // Show secrets panel
  if (showSecretsPanel) {
    const secretsManager = activeSession?.client.getSecretsManager?.();

    const handleSecretsGet = async (name: string, scope?: 'global' | 'assistant') => {
      if (!secretsManager) throw new Error('Secrets not available');
      const value = await secretsManager.get(name, scope, 'plain');
      return value || '';
    };

    const handleSecretsDelete = async (name: string, scope: 'global' | 'assistant') => {
      if (!secretsManager) throw new Error('Secrets not available');
      await secretsManager.delete(name, scope);
      const secrets = await secretsManager.list('all');
      setSecretsList(secrets);
    };

    return (
      <Box flexDirection="column" padding={1}>
        <SecretsPanel
          secrets={secretsList}
          onGet={handleSecretsGet}
          onDelete={handleSecretsDelete}
          onClose={() => setShowSecretsPanel(false)}
          error={secretsError}
        />
      </Box>
    );
  }

  // Show assistants dashboard panel
  if (showAssistantsDashboard) {
    const sessions = registry.listSessions();
    const sessionEntries = sessions.map((s, i) => ({
      id: s.id,
      label: s.label,
      assistantId: s.assistantId,
      assistantName: s.assistantId ? (s.label || `Assistant ${i + 1}`) : null,
      isActive: s.id === activeSessionId,
      isProcessing: s.isProcessing,
      isPaused: false, // Would need to check from loop
      cwd: s.cwd,
      startedAt: s.startedAt,
      unreadMessages: 0,
    }));

    const swarmCoordinator = activeSession?.client.getSwarmCoordinator?.();
    const swarmState = swarmCoordinator?.getSerializableState?.();

    const projectBudgetStatus = budgetTrackerRef.current?.getActiveProject()
      ? budgetTrackerRef.current.checkBudget('project')
      : null;

    return (
      <Box flexDirection="column" padding={1}>
        <AssistantsDashboard
          sessions={sessionEntries}
          projectBudget={projectBudgetStatus || undefined}
          projectName={budgetTrackerRef.current?.getActiveProject() || undefined}
          swarmStatus={swarmState?.status || null}
          swarmTaskProgress={swarmState ? `${swarmState.metrics.completedTasks}/${swarmState.metrics.totalTasks}` : null}
          onSwitchSession={async (sessionId) => {
            await switchToSession(sessionId);
            setShowAssistantsDashboard(false);
          }}
          onMessageAgent={(assistantId) => {
            setShowAssistantsDashboard(false);
            activeSession?.client.send(`/messages send ${assistantId}`);
          }}
          onPauseResume={(sessionId) => {
            const session = registry.getSession(sessionId);
            if (session) {
              const loop = session.client.getAssistantLoop?.();
              if (loop?.isPaused?.()) {
                loop.resume?.();
              }
            }
          }}
          onCancel={() => setShowAssistantsDashboard(false)}
        />
      </Box>
    );
  }

  // Show swarm panel
  if (showSwarmPanel) {
    const swarmCoordinator = activeSession?.client.getSwarmCoordinator?.();
    const swarmState = swarmCoordinator?.getSerializableState?.() || null;
    const swarmConfig = swarmCoordinator?.getConfig?.() || null;
    const swarmMemory = swarmCoordinator?.getMemory?.();
    const memoryStats = swarmMemory ? swarmMemory.getStats() : null;

    return (
      <Box flexDirection="column" padding={1}>
        <SwarmPanel
          state={swarmState}
          config={swarmConfig}
          memoryStats={memoryStats}
          onStop={() => {
            swarmCoordinator?.stop?.();
          }}
          onCancel={() => setShowSwarmPanel(false)}
        />
      </Box>
    );
  }

  // Show workspace panel
  if (showWorkspacePanel) {
    const handleWorkspaceArchive = async (id: string) => {
      const { SharedWorkspaceManager } = await import('@hasna/assistants-core');
      const mgr = new SharedWorkspaceManager();
      mgr.archive(id);
      setWorkspacesList(mgr.list(true));
    };

    const handleWorkspaceDelete = async (id: string) => {
      const { SharedWorkspaceManager } = await import('@hasna/assistants-core');
      const mgr = new SharedWorkspaceManager();
      mgr.delete(id);
      setWorkspacesList(mgr.list(true));
    };

    return (
      <Box flexDirection="column" padding={1}>
        <WorkspacePanel
          workspaces={workspacesList}
          onArchive={handleWorkspaceArchive}
          onDelete={handleWorkspaceDelete}
          onClose={() => setShowWorkspacePanel(false)}
        />
      </Box>
    );
  }

  // Show resume panel
  if (showResumePanel) {
    return (
      <Box flexDirection="column" padding={1}>
        <ResumePanel
          sessions={resumeSessions}
          activeCwd={cwd}
          initialFilter={resumeFilter}
          onResume={(session) => {
            void resumeFromSavedSession(session);
          }}
          onRefresh={refreshResumeSessions}
          onClose={() => setShowResumePanel(false)}
        />
      </Box>
    );
  }

  // Show heartbeat panel
  if (showHeartbeatPanel) {
    const sessionId = activeSessionId || registry.getActiveSession()?.id;
    const handleRefresh = async () => {
      if (!sessionId) {
        setHeartbeatRuns([]);
        return;
      }
      const runs = await readHeartbeatHistoryBySession(sessionId, {
        historyPath: currentConfig?.heartbeat?.historyPath,
        order: 'desc',
      });
      setHeartbeatRuns(runs);
    };

    return (
      <Box flexDirection="column" padding={1}>
        <HeartbeatPanel
          runs={heartbeatRuns}
          heartbeatState={heartbeatState}
          onRefresh={handleRefresh}
          onClose={() => setShowHeartbeatPanel(false)}
        />
      </Box>
    );
  }

  // Show logs panel
  if (showLogsPanel) {
    return (
      <Box flexDirection="column" padding={1}>
        <LogsPanel
          onCancel={() => setShowLogsPanel(false)}
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

  // Show webhooks panel
  if (showWebhooksPanel) {
    const webhooksManager = activeSession?.client.getWebhooksManager?.();
    if (!webhooksManager) {
      return (
        <CloseOnAnyKeyPanel
          message="Webhooks are not enabled. Set webhooks.enabled: true in config."
          onClose={() => setShowWebhooksPanel(false)}
        />
      );
    }
    return (
      <WebhooksPanel
        manager={webhooksManager}
        onClose={() => setShowWebhooksPanel(false)}
      />
    );
  }

  // Show channels panel
  if (showChannelsPanel) {
    const channelsManager = activeSession?.client.getChannelsManager?.();
    if (!channelsManager) {
      return (
        <CloseOnAnyKeyPanel
          message="Channels are not enabled. Set channels.enabled: true in config."
          onClose={() => setShowChannelsPanel(false)}
        />
      );
    }
    return (
      <ChannelsPanel
        manager={channelsManager}
        onClose={() => setShowChannelsPanel(false)}
        activePersonId={activeSession?.client.getPeopleManager?.()?.getActivePersonId?.() || undefined}
        activePersonName={activeSession?.client.getPeopleManager?.()?.getActivePerson?.()?.name || undefined}
        onPersonMessage={(channelName, personName, message) => {
          // Get channel members to trigger multi-agent responses
          const members: ChannelMember[] = channelsManager.getMembers(channelName);

          // Use ChannelAgentPool to trigger independent responses from all assistant members
          const agentPool = activeSession?.client.getChannelAgentPool?.();
          if (agentPool) {
            // Pool handles @mention filtering, concurrent sends, and client caching
            agentPool.triggerResponses(
              channelName,
              personName,
              message,
              members,
              activeSession?.assistantId || undefined,
            );
          }

          // Also trigger the active session's assistant (if it's a channel member)
          const activeAssistantId = activeSession?.assistantId;
          const isActiveMember = activeAssistantId && members.some(
            (m) => m.assistantId === activeAssistantId && m.memberType === 'assistant'
          );

          // Check if @mentions exclude the active assistant
          const mentions = parseMentions(message);
          let activeAssistantTargeted = true;
          if (mentions.length > 0) {
            const assistantMembers = members.filter((m) => m.memberType === 'assistant');
            const knownNames = assistantMembers.map((m) => ({ id: m.assistantId, name: m.assistantName }));
            const resolved = mentions
              .map((m) => resolveNameToKnown(m, knownNames))
              .filter(Boolean) as Array<{ id: string; name: string }>;
            if (resolved.length > 0) {
              activeAssistantTargeted = resolved.some((r) => r.id === activeAssistantId);
            } else {
              // Mentions present but none resolved — don't trigger active assistant either
              activeAssistantTargeted = false;
            }
          }

          if (isActiveMember && activeAssistantTargeted) {
            const prompt = `[Channel Message] ${personName} posted in #${channelName}: "${message}"\n\nYou are in a group channel with other assistants and people. Respond in #${channelName} using channel_send. Be helpful and conversational. You may reference or build on what other assistants have said.`;
            activeSession?.client.send(prompt);
          }
        }}
      />
    );
  }

  // Show people panel
  if (showPeoplePanel) {
    const peopleManager = activeSession?.client.getPeopleManager?.();
    if (!peopleManager) {
      return (
        <CloseOnAnyKeyPanel
          message="People system is not available."
          onClose={() => setShowPeoplePanel(false)}
        />
      );
    }
    return (
      <PeoplePanel
        manager={peopleManager}
        onClose={() => setShowPeoplePanel(false)}
      />
    );
  }

  // Show telephony panel
  if (showTelephonyPanel) {
    const telephonyManager = activeSession?.client.getTelephonyManager?.();
    if (!telephonyManager) {
      return (
        <CloseOnAnyKeyPanel
          message="Telephony is not enabled. Set telephony.enabled: true in config."
          onClose={() => setShowTelephonyPanel(false)}
        />
      );
    }
    return (
      <TelephonyPanel
        manager={telephonyManager}
        onClose={() => setShowTelephonyPanel(false)}
      />
    );
  }

  // Show orders panel
  if (showOrdersPanel) {
    const ordersManager = activeSession?.client.getOrdersManager?.();
    if (!ordersManager) {
      return (
        <CloseOnAnyKeyPanel
          message="Orders are not enabled. Set orders.enabled: true in config."
          onClose={() => setShowOrdersPanel(false)}
        />
      );
    }
    return (
      <OrdersPanel
        manager={ordersManager}
        onClose={() => setShowOrdersPanel(false)}
      />
    );
  }

  // Show messages panel (unified: assistant messages + email inbox)
  if (showMessagesPanel) {
    const messagesManager = activeSession?.client.getMessagesManager?.();
    const inboxManager = activeSession?.client.getInboxManager?.();

    // --- Assistant messages handlers ---
    const handleMessagesRead = async (id: string) => {
      if (!messagesManager) throw new Error('Messages not available');
      const msg = await messagesManager.read(id);
      return {
        id: msg.id,
        threadId: msg.threadId,
        fromAssistantId: msg.fromAssistantId,
        fromAssistantName: msg.fromAssistantName,
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
      const msgs = await messagesManager.list({ limit: 50 });
      setMessagesList(msgs.map((m: { id: string; threadId: string; fromAssistantId: string; fromAssistantName: string; subject?: string; preview: string; body?: string; priority: string; status: string; createdAt: string; replyCount?: number }) => ({
        id: m.id,
        threadId: m.threadId,
        fromAssistantId: m.fromAssistantId,
        fromAssistantName: m.fromAssistantName,
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
      if (activeSession) {
        activeSession.client.addSystemMessage(`[Injected message from ${msg.fromAssistantName}]\n\n${msg.body || msg.preview}`);
      }
      await messagesManager.markStatus?.(id, 'injected');
      const msgs = await messagesManager.list({ limit: 50 });
      setMessagesList(msgs.map((m: { id: string; threadId: string; fromAssistantId: string; fromAssistantName: string; subject?: string; preview: string; body?: string; priority: string; status: string; createdAt: string; replyCount?: number }) => ({
        id: m.id,
        threadId: m.threadId,
        fromAssistantId: m.fromAssistantId,
        fromAssistantName: m.fromAssistantName,
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
      await messagesManager.send({
        to: msg.fromAssistantId,
        body,
        replyTo: id,
      });
    };

    // --- Inbox handlers ---
    const handleInboxRead = async (id: string): Promise<Email> => {
      if (!inboxManager) throw new Error('Inbox not available');
      const email = await inboxManager.read(id);
      if (!email) throw new Error('Email not found');
      const emails = await inboxManager.list({ limit: 50 });
      setInboxEmails(emails);
      return email;
    };

    const handleInboxDelete = async (id: string) => {
      if (!inboxManager) throw new Error('Inbox not available');
      throw new Error('Delete not implemented yet');
    };

    const handleInboxFetch = async (): Promise<number> => {
      if (!inboxManager) throw new Error('Inbox not available');
      const count = await inboxManager.fetch({ limit: 20 });
      const emails = await inboxManager.list({ limit: 50 });
      setInboxEmails(emails);
      return count;
    };

    const handleInboxMarkRead = async (id: string) => {
      if (!inboxManager) throw new Error('Inbox not available');
      await inboxManager.markRead(id);
      const emails = await inboxManager.list({ limit: 50 });
      setInboxEmails(emails);
    };

    const handleInboxMarkUnread = async (id: string) => {
      if (!inboxManager) throw new Error('Inbox not available');
      await inboxManager.markUnread(id);
      const emails = await inboxManager.list({ limit: 50 });
      setInboxEmails(emails);
    };

    const handleInboxReply = (id: string) => {
      setShowMessagesPanel(false);
      activeSession?.client.send(`/messages compose ${id}`);
    };

    if (!messagesManager && !inboxManager) {
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
          inboxEmails={inboxEmails}
          onInboxRead={handleInboxRead}
          onInboxDelete={handleInboxDelete}
          onInboxFetch={handleInboxFetch}
          onInboxMarkRead={handleInboxMarkRead}
          onInboxMarkUnread={handleInboxMarkUnread}
          onInboxReply={handleInboxReply}
          inboxError={inboxError}
          inboxEnabled={inboxEnabled}
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
      <Static key={staticResetKey} items={displayMessages}>
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
      {showDynamicPanel && (
        <>
          {isProcessing && streamingTrimmed && (
            <Box marginBottom={1}>
              <Text dimColor>⋯ showing latest output</Text>
            </Box>
          )}
          {isProcessing && activityTrim.trimmed && (
            <Box marginBottom={1}>
              <Text dimColor>⋯ showing latest activity</Text>
            </Box>
          )}
          <Messages
            key="streaming"
            messages={[]}
            currentResponse={undefined}
            streamingMessages={combinedStreamingMessages}
            currentToolCall={undefined}
            lastToolResult={undefined}
            activityLog={isProcessing ? activityTrim.entries : []}
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
        ref={inputRef}
        onSubmit={handleSubmit}
        isProcessing={isBusy}
        queueLength={activeQueue.length + inlineCount}
        commands={commands}
        skills={skills}
        isAskingUser={Boolean(activeAskQuestion)}
        askPlaceholder={askPlaceholder}
        allowBlankAnswer={activeAskQuestion?.required === false}
        footerHints={listenHints}
        assistantName={identityInfo?.assistant?.name || undefined}
        isRecording={pttRecording}
        recordingStatus={pttStatus}
        onStopRecording={togglePushToTalk}
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

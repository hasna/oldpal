import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { SessionRegistry, type SessionInfo } from '@oldpal/core';
import type { StreamChunk, Message, ToolCall, ToolResult, TokenUsage } from '@oldpal/shared';
import { generateId, now } from '@oldpal/shared';
import { Input } from './Input';
import { Messages } from './Messages';
import { Status } from './Status';
import { Spinner } from './Spinner';
import { ProcessingIndicator } from './ProcessingIndicator';
import { WelcomeBanner } from './WelcomeBanner';
import { SessionSelector } from './SessionSelector';

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
      const writePath = String(input.path || input.file_path || '');
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

interface AppProps {
  cwd: string;
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
  tokenUsage: TokenUsage | undefined;
  processingStartTime: number | undefined;
  currentTurnTokens: number;
  messageQueue: string[];
  error: string | null;
}

export function App({ cwd }: AppProps) {
  const { exit } = useApp();

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
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | undefined>();
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

  // Save current session UI state
  const saveCurrentSessionState = useCallback(() => {
    if (activeSessionId) {
      sessionUIStates.current.set(activeSessionId, {
        messages,
        currentResponse: responseRef.current,
        activityLog: activityLogRef.current,
        tokenUsage,
        processingStartTime,
        currentTurnTokens,
        messageQueue,
        error,
      });
    }
  }, [activeSessionId, messages, tokenUsage, processingStartTime, currentTurnTokens, messageQueue, error]);

  // Load session UI state
  const loadSessionState = useCallback((sessionId: string) => {
    const state = sessionUIStates.current.get(sessionId);
    if (state) {
      setMessages(state.messages);
      setCurrentResponse(state.currentResponse);
      responseRef.current = state.currentResponse;
      setActivityLog(state.activityLog);
      activityLogRef.current = state.activityLog;
      setTokenUsage(state.tokenUsage);
      setProcessingStartTime(state.processingStartTime);
      setCurrentTurnTokens(state.currentTurnTokens);
      setMessageQueue(state.messageQueue);
      setError(state.error);
    } else {
      // New session - reset state
      setMessages([]);
      setCurrentResponse('');
      responseRef.current = '';
      setActivityLog([]);
      activityLogRef.current = [];
      setTokenUsage(undefined);
      setProcessingStartTime(undefined);
      setCurrentTurnTokens(0);
      setMessageQueue([]);
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
      setError(chunk.error);
      setIsProcessing(false);
    } else if (chunk.type === 'exit') {
      // Exit command was issued
      registry.closeAll();
      exit();
    } else if (chunk.type === 'usage' && chunk.usage) {
      setTokenUsage(chunk.usage);
      // Track tokens for current turn
      setCurrentTurnTokens((prev) => prev + (chunk.usage?.outputTokens || 0));
    } else if (chunk.type === 'done') {
      // Save any remaining text
      if (responseRef.current.trim()) {
        const textEntry = {
          id: generateId(),
          type: 'text' as const,
          content: responseRef.current,
          timestamp: now(),
        };
        activityLogRef.current = [...activityLogRef.current, textEntry];
      }

      // Add complete message to history
      const fullContent = activityLogRef.current
        .filter(e => e.type === 'text')
        .map(e => e.content)
        .join('\n') + (responseRef.current ? '\n' + responseRef.current : '');

      if (fullContent.trim() || toolCallsRef.current.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content: fullContent.trim(),
            timestamp: now(),
            toolCalls: toolCallsRef.current.length > 0 ? [...toolCallsRef.current] : undefined,
            toolResults: toolResultsRef.current.length > 0 ? [...toolResultsRef.current] : undefined,
          },
        ]);
      }

      // Reset all state
      setCurrentResponse('');
      responseRef.current = '';
      toolCallsRef.current = [];
      toolResultsRef.current = [];
      setCurrentToolCall(undefined);
      setActivityLog([]);
      activityLogRef.current = [];
      setProcessingStartTime(undefined);
      setCurrentTurnTokens(0);
      setIsProcessing(false);

      // Update token usage from client
      const activeSession = registry.getActiveSession();
      if (activeSession) {
        setTokenUsage(activeSession.client.getTokenUsage());
      }
    }
  }, [registry, exit]);

  // Initialize first session
  useEffect(() => {
    const initSession = async () => {
      try {
        // Register chunk handler
        registry.onChunk(handleChunk);
        registry.onError((err) => {
          setError(err.message);
          setIsProcessing(false);
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
  }, [cwd, registry, handleChunk]);

  // Process queued messages
  const processQueue = useCallback(async () => {
    const activeSession = registryRef.current.getActiveSession();
    if (!activeSession || messageQueue.length === 0) return;

    const nextMessage = messageQueue[0];
    setMessageQueue((prev) => prev.slice(1));

    // Add user message
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: nextMessage,
      timestamp: now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Reset state
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

    registryRef.current.setProcessing(activeSession.id, true);
    await activeSession.client.send(nextMessage);
  }, [messageQueue]);

  // Process queue when not processing
  useEffect(() => {
    if (!isProcessing && messageQueue.length > 0) {
      processQueue();
    }
  }, [isProcessing, messageQueue.length, processQueue]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll) {
      setScrollOffset(0);
    }
  }, [messages.length, autoScroll]);

  // Max visible messages - reduce when processing to prevent overflow
  const baseMaxVisible = 10;
  const toolCallsHeight = isProcessing ? Math.min(toolCallsRef.current.length, 5) : 0;
  const maxVisibleMessages = Math.max(3, baseMaxVisible - toolCallsHeight);

  // Get session info
  const sessions = registry.listSessions();
  const activeSession = registry.getActiveSession();
  const sessionIndex = activeSessionId ? registry.getSessionIndex(activeSessionId) : 0;
  const sessionCount = registry.getSessionCount();
  const backgroundProcessingCount = registry.getBackgroundProcessingSessions().length;

  // Handle session switch
  const handleSessionSwitch = useCallback(async (sessionId: string) => {
    if (sessionId === activeSessionId) {
      setShowSessionSelector(false);
      return;
    }

    // Save current session state
    saveCurrentSessionState();

    // Switch session in registry
    await registry.switchSession(sessionId);
    setActiveSessionId(sessionId);

    // Load new session state
    loadSessionState(sessionId);

    // Update processing state from new session
    const session = registry.getSession(sessionId);
    if (session) {
      setIsProcessing(session.isProcessing);
    }

    setShowSessionSelector(false);
  }, [activeSessionId, registry, saveCurrentSessionState, loadSessionState]);

  // Handle new session creation
  const handleNewSession = useCallback(async () => {
    try {
      // Save current session state
      saveCurrentSessionState();

      // Create new session
      const newSession = await registry.createSession(cwd);

      // Switch to new session
      await registry.switchSession(newSession.id);
      setActiveSessionId(newSession.id);

      // Initialize empty state for new session
      loadSessionState(newSession.id);
      setIsProcessing(false);

      setShowSessionSelector(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      setShowSessionSelector(false);
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
        // Save partial response if any
        if (responseRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content: responseRef.current + '\n\n[stopped]',
              timestamp: now(),
            },
          ]);
          setCurrentResponse('');
          responseRef.current = '';
        }
        setIsProcessing(false);
      } else {
        registry.closeAll();
        exit();
      }
    }
    // Escape: stop processing or close session selector
    if (key.escape) {
      if (isProcessing && activeSession) {
        activeSession.client.stop();
        if (responseRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content: responseRef.current + '\n\n[stopped]',
              timestamp: now(),
            },
          ]);
          setCurrentResponse('');
          responseRef.current = '';
        }
        setIsProcessing(false);
      }
    }

    // Page Up: scroll up through messages
    if (key.pageUp || (key.shift && key.upArrow)) {
      setScrollOffset((prev) => {
        const maxOffset = Math.max(0, messages.length - maxVisibleMessages);
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
      const maxOffset = Math.max(0, messages.length - maxVisibleMessages);
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
        setMessageQueue((prev) => [...prev, trimmedInput]);
        return;
      }

      // Interrupt mode: stop current and send immediately
      if (mode === 'interrupt' && isProcessing) {
        activeSession.client.stop();
        // Save partial response
        if (responseRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content: responseRef.current + '\n\n[interrupted]',
              timestamp: now(),
            },
          ]);
        }
        setCurrentResponse('');
        responseRef.current = '';
        setIsProcessing(false);
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
      setMessages((prev) => [...prev, userMessage]);

      // Reset state
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

      // Mark session as processing
      registry.setProcessing(activeSession.id, true);

      // Send to agent
      await activeSession.client.send(trimmedInput);
    },
    [activeSession, isProcessing, registry, sessions, handleNewSession, handleSessionSwitch]
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

  // Show welcome banner only when no messages
  const showWelcome = messages.length === 0 && !isProcessing;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Welcome banner */}
      {showWelcome && (
        <WelcomeBanner
          version="0.6.0"
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
          <Text dimColor>↑ {scrollOffset} more messages above (Shift+↓ or Ctrl+D to scroll down)</Text>
        </Box>
      )}

      {/* Messages */}
      <Messages
        messages={messages}
        currentResponse={isProcessing ? currentResponse : undefined}
        currentToolCall={undefined} // Moved to ToolCallBox
        lastToolResult={undefined}
        activityLog={isProcessing ? activityLog.filter((e) => e.type === 'text') : []}
        scrollOffset={scrollOffset}
        maxVisible={maxVisibleMessages}
      />

      {/* Tool calls - show compact single line during processing */}
      {isProcessing && toolCallEntries.length > 0 && (
        <Box marginY={1}>
          <Text dimColor>
            ⚙ {toolCallEntries.length} tool{toolCallEntries.length > 1 ? 's' : ''} running
            {toolCallEntries.length > 0 && `: ${formatToolName(toolCallEntries[toolCallEntries.length - 1].toolCall)}`}
            {toolCallEntries.length > 1 && ` (+${toolCallEntries.length - 1} more)`}
          </Text>
        </Box>
      )}

      {/* Queue indicator */}
      {messageQueue.length > 0 && (
        <Box marginY={1}>
          <Text dimColor>
            {messageQueue.length} message{messageQueue.length > 1 ? 's' : ''} queued
          </Text>
        </Box>
      )}

      {/* Error */}
      {error && (
        <Box marginY={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

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
        queueLength={messageQueue.length}
        skills={skills}
      />

      {/* Status bar */}
      <Status
        isProcessing={isProcessing}
        cwd={activeSession?.cwd || cwd}
        queueLength={messageQueue.length}
        tokenUsage={tokenUsage}
        sessionIndex={sessionIndex}
        sessionCount={sessionCount}
        backgroundProcessingCount={backgroundProcessingCount}
      />
    </Box>
  );
}

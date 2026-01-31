import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { EmbeddedClient } from '@oldpal/core';
import type { StreamChunk, Message, ToolCall, ToolResult, TokenUsage } from '@oldpal/shared';
import { generateId, now } from '@oldpal/shared';
import { Input } from './Input';
import { Messages } from './Messages';
import { Status } from './Status';
import { Spinner } from './Spinner';
import { ProcessingIndicator } from './ProcessingIndicator';
import { WelcomeBanner } from './WelcomeBanner';

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

export function App({ cwd }: AppProps) {
  const { exit } = useApp();
  const [client, setClient] = useState<EmbeddedClient | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentResponse, setCurrentResponse] = useState('');
  const [currentToolCall, setCurrentToolCall] = useState<ToolCall | undefined>();
  const [lastToolResult, setLastToolResult] = useState<ToolResult | undefined>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | undefined>();
  const [processingStartTime, setProcessingStartTime] = useState<number | undefined>();
  const [currentTurnTokens, setCurrentTurnTokens] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);


  // Use ref to track response for the done callback
  const responseRef = useRef('');
  const clientRef = useRef<EmbeddedClient | null>(null);
  const toolCallsRef = useRef<ToolCall[]>([]);
  const toolResultsRef = useRef<ToolResult[]>([]);

  // Process queued messages
  const processQueue = useCallback(async () => {
    if (!clientRef.current || messageQueue.length === 0) return;

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
    setLastToolResult(undefined);
    setActivityLog([]);
    setProcessingStartTime(Date.now());
    setCurrentTurnTokens(0);
    setIsProcessing(true);

    await clientRef.current.send(nextMessage);
  }, [messageQueue]);

  // Initialize client
  useEffect(() => {
    const initClient = async () => {
      try {
        const newClient = new EmbeddedClient(cwd);
        clientRef.current = newClient;

        newClient.onChunk((chunk: StreamChunk) => {
          if (chunk.type === 'text' && chunk.content) {
            responseRef.current += chunk.content;
            setCurrentResponse(responseRef.current);
          } else if (chunk.type === 'tool_use' && chunk.toolCall) {
            // Save any accumulated text before the tool call
            if (responseRef.current.trim()) {
              setActivityLog((prev) => [
                ...prev,
                {
                  id: generateId(),
                  type: 'text',
                  content: responseRef.current,
                  timestamp: now(),
                },
              ]);
              setCurrentResponse('');
              responseRef.current = '';
            }

            // Track tool call
            toolCallsRef.current.push(chunk.toolCall);
            setActivityLog((prev) => [
              ...prev,
              {
                id: generateId(),
                type: 'tool_call',
                toolCall: chunk.toolCall,
                timestamp: now(),
              },
            ]);
            setCurrentToolCall(chunk.toolCall);
          } else if (chunk.type === 'tool_result' && chunk.toolResult) {
            // Track tool result
            toolResultsRef.current.push(chunk.toolResult);
            setActivityLog((prev) => [
              ...prev,
              {
                id: generateId(),
                type: 'tool_result',
                toolResult: chunk.toolResult,
                timestamp: now(),
              },
            ]);
            setCurrentToolCall(undefined);
          } else if (chunk.type === 'error' && chunk.error) {
            setError(chunk.error);
            setIsProcessing(false);
          } else if (chunk.type === 'exit') {
            // Exit command was issued
            exit();
          } else if (chunk.type === 'usage' && chunk.usage) {
            setTokenUsage(chunk.usage);
            // Track tokens for current turn
            setCurrentTurnTokens((prev) => prev + (chunk.usage?.outputTokens || 0));
          } else if (chunk.type === 'done') {
            // Save any remaining text
            if (responseRef.current.trim()) {
              setActivityLog((prev) => [
                ...prev,
                {
                  id: generateId(),
                  type: 'text',
                  content: responseRef.current,
                  timestamp: now(),
                },
              ]);
            }

            // Add complete message to history
            const fullContent = activityLog
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
            setProcessingStartTime(undefined);
            setCurrentTurnTokens(0);
            setIsProcessing(false);

            // Update token usage
            if (newClient) {
              setTokenUsage(newClient.getTokenUsage());
            }
          }
        });

        newClient.onError((err: Error) => {
          setError(err.message);
          setIsProcessing(false);
        });

        await newClient.initialize();
        setClient(newClient);
        setIsInitializing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIsInitializing(false);
      }
    };

    initClient();
  }, [cwd]);

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

  // Handle keyboard shortcuts
  useInput((input, key) => {
    // Ctrl+C: stop or exit
    if (key.ctrl && input === 'c') {
      if (isProcessing && client) {
        client.stop();
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
        exit();
      }
    }
    // Escape: stop processing
    if (key.escape && isProcessing && client) {
      client.stop();
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
  });

  // Handle message submission
  const handleSubmit = useCallback(
    async (input: string, mode: 'normal' | 'interrupt' | 'queue' = 'normal') => {
      if (!client || !input.trim()) return;

      const trimmedInput = input.trim();

      // Queue mode: add to queue for later
      if (mode === 'queue' || (isProcessing && mode === 'normal')) {
        setMessageQueue((prev) => [...prev, trimmedInput]);
        return;
      }

      // Interrupt mode: stop current and send immediately
      if (mode === 'interrupt' && isProcessing) {
        client.stop();
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
      setLastToolResult(undefined);
      setActivityLog([]);
      setProcessingStartTime(Date.now());
      setCurrentTurnTokens(0);
      setIsProcessing(true);

      // Send to agent
      await client.send(trimmedInput);
    },
    [client, isProcessing]
  );

  if (isInitializing) {
    return (
      <Box flexDirection="column" padding={1}>
        <Spinner label="Initializing..." />
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
          version="0.4.1"
          model="claude-sonnet-4"
          directory={cwd}
        />
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
      />

      {/* Status bar */}
      <Status isProcessing={isProcessing} cwd={cwd} queueLength={messageQueue.length} tokenUsage={tokenUsage} />
    </Box>
  );
}

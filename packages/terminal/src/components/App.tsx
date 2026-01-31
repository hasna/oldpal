import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { EmbeddedClient } from '@oldpal/core';
import type { StreamChunk, Message, ToolCall, ToolResult, TokenUsage } from '@oldpal/shared';
import { generateId, now } from '@oldpal/shared';
import { Input } from './Input';
import { Messages } from './Messages';
import { Status } from './Status';
import { Spinner } from './Spinner';

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
          } else if (chunk.type === 'usage' && chunk.usage) {
            setTokenUsage(chunk.usage);
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

  return (
    <Box flexDirection="column" padding={1}>
      {/* Messages */}
      <Messages
        messages={messages}
        currentResponse={isProcessing ? currentResponse : undefined}
        currentToolCall={currentToolCall}
        lastToolResult={lastToolResult}
        activityLog={isProcessing ? activityLog : []}
      />

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

      {/* Processing indicator (only when no tool call or response) */}
      {isProcessing && !currentToolCall && !currentResponse && (
        <Box marginY={1}>
          <Spinner label="Thinking..." />
        </Box>
      )}

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

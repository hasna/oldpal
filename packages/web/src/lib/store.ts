import { create } from 'zustand';
import { generateId, now } from '@hasna/assistants-shared';
import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';

type ToolCallWithMeta = ToolCall & { result?: ToolResult; startedAt?: number };

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentToolCalls: ToolCallWithMeta[];
  currentStreamMessageId: string | null;
  sessionId: string | null;
  sessions: Array<{ id: string; label: string; createdAt: number }>;
  // Note: isStreaming is stored but always set to false when saving/restoring to prevent stuck sessions
  sessionSnapshots: Record<string, { messages: Message[]; toolCalls: ToolCallWithMeta[]; streamMessageId: string | null; isStreaming: boolean }>;
  /** Buffer for tool results that arrive before their corresponding tool_call */
  pendingToolResults: Map<string, ToolResult>;
  /** Live dictation draft text while /listen is active */
  listeningDraft: string;
  /** Whether live dictation mode is active */
  isListening: boolean;

  setSessionId: (sessionId: string) => void;
  createSession: (label?: string) => string;
  switchSession: (sessionId: string) => void;
  addMessage: (message: Message) => void;
  appendMessageContent: (id: string | undefined, content: string) => void;
  setStreaming: (streaming: boolean) => void;
  setListening: (listening: boolean) => void;
  setListeningDraft: (draft: string) => void;
  addToolCall: (call: ToolCall, messageId?: string) => void;
  updateToolResult: (id: string, result: ToolResult) => void;
  finalizeToolCalls: (messageId?: string) => void;
  clearToolCalls: () => void;
  clearMessages: () => void;
  clearAll: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentToolCalls: [],
  currentStreamMessageId: null,
  sessionId: null,
  sessions: [],
  sessionSnapshots: {},
  pendingToolResults: new Map(),
  listeningDraft: '',
  isListening: false,

  setSessionId: (sessionId) => set({ sessionId }),

  createSession: (label) => {
    const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
    const createdAt = Date.now();
    const sessionLabel = label || `Session ${get().sessions.length + 1}`;
    set((state) => ({
      sessions: [...state.sessions, { id, label: sessionLabel, createdAt }],
      sessionId: id,
      isStreaming: false,
      messages: [],
      currentToolCalls: [],
      currentStreamMessageId: null,
      sessionSnapshots: {
        ...state.sessionSnapshots,
        ...(state.sessionId
          ? {
              [state.sessionId]: {
                messages: state.messages,
                toolCalls: state.currentToolCalls,
                streamMessageId: state.currentStreamMessageId,
                isStreaming: state.isStreaming,
              },
            }
          : {}),
        [id]: { messages: [], toolCalls: [], streamMessageId: null, isStreaming: false },
      },
    }));
    return id;
  },

  switchSession: (sessionId) => {
    set((state) => {
      const snapshots = { ...state.sessionSnapshots };
      if (state.sessionId) {
        snapshots[state.sessionId] = {
          messages: state.messages,
          toolCalls: state.currentToolCalls,
          streamMessageId: state.currentStreamMessageId,
          // Don't persist isStreaming - it's ephemeral and should not survive session switches
          // This prevents sessions from getting stuck in streaming state after disconnects
          isStreaming: false,
        };
      }
      const snapshot = snapshots[sessionId] || { messages: [], toolCalls: [], streamMessageId: null, isStreaming: false };
      return {
        sessionId,
        // Always reset streaming state when switching sessions - streaming is per-connection, not per-session
        isStreaming: false,
        messages: snapshot.messages,
        currentToolCalls: snapshot.toolCalls,
        currentStreamMessageId: snapshot.streamMessageId ?? null,
        sessionSnapshots: snapshots,
      };
    });
  },

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
      sessionSnapshots: state.sessionId
        ? {
            ...state.sessionSnapshots,
            [state.sessionId]: {
              messages: [...state.messages, message],
              toolCalls: state.currentToolCalls,
              streamMessageId: state.currentStreamMessageId,
              isStreaming: state.isStreaming,
            },
          }
        : state.sessionSnapshots,
    })),

  appendMessageContent: (id, content) =>
    set((state) => {
      const messages = [...state.messages];
      let streamId: string | null = null;

      // If messageId is provided, try to find that specific message
      if (id) {
        let matchIndex = -1;
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          if (messages[i].id === id && messages[i].role === 'assistant') {
            matchIndex = i;
            break;
          }
        }
        if (matchIndex >= 0) {
          // Found the message, append to it
          messages[matchIndex] = { ...messages[matchIndex], content: messages[matchIndex].content + content };
          streamId = id;
        } else {
          // messageId was provided but not found - create a placeholder with that ID
          // rather than falling back to a different message which would corrupt ordering
          messages.push({
            id,
            role: 'assistant',
            content,
            timestamp: now(),
          });
          streamId = id;
        }
      } else {
        // No messageId provided - fall back to last assistant message or create new
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          messages[messages.length - 1] = { ...lastMessage, content: lastMessage.content + content };
          streamId = lastMessage.id;
        } else {
          const newId = generateId();
          messages.push({
            id: newId,
            role: 'assistant',
            content,
            timestamp: now(),
          });
          streamId = newId;
        }
      }
      return {
        messages,
        currentStreamMessageId: streamId ?? state.currentStreamMessageId,
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages,
                toolCalls: state.currentToolCalls,
                streamMessageId: streamId ?? state.currentStreamMessageId,
                isStreaming: state.isStreaming,
              },
            }
          : state.sessionSnapshots,
      };
    }),

  setStreaming: (streaming) =>
    set((state) => ({
      isStreaming: streaming,
      // Don't persist isStreaming to snapshots - it's ephemeral connection state
      // Persisting it can cause sessions to get stuck in streaming mode after disconnects
    })),

  setListening: (listening) =>
    set(() => ({
      isListening: listening,
      ...(listening ? {} : { listeningDraft: '' }),
    })),

  setListeningDraft: (draft) =>
    set(() => ({
      listeningDraft: draft,
    })),

  addToolCall: (call, messageId) =>
    set((state) => {
      let targetMessageId: string | null = messageId ?? state.currentStreamMessageId;
      let messages = state.messages;
      if (!targetMessageId) {
        let fallbackId: string | null = null;
        for (let i = state.messages.length - 1; i >= 0; i -= 1) {
          const message = state.messages[i];
          if (!fallbackId && message.role === 'assistant') {
            fallbackId = message.id;
          }
        }
        targetMessageId = fallbackId;
      }
      // If no assistant message exists (tool-only response), create a placeholder
      if (!targetMessageId) {
        const newId = generateId();
        const placeholderMessage: Message = {
          id: newId,
          role: 'assistant',
          content: '',
          timestamp: now(),
        };
        messages = [...state.messages, placeholderMessage];
        targetMessageId = newId;
      }
      const shouldReset = targetMessageId && targetMessageId !== state.currentStreamMessageId;
      const callWithMeta: ToolCallWithMeta = { ...call, startedAt: Date.now() };

      // Check if we have a buffered result for this tool call (arrived out of order)
      const pendingResult = state.pendingToolResults.get(call.id);
      if (pendingResult) {
        callWithMeta.result = pendingResult;
        // Remove from pending buffer
        const newPending = new Map(state.pendingToolResults);
        newPending.delete(call.id);
        const nextCalls = shouldReset ? [callWithMeta] : [...state.currentToolCalls, callWithMeta];
        return {
          messages,
          currentToolCalls: nextCalls,
          currentStreamMessageId: targetMessageId ?? state.currentStreamMessageId,
          pendingToolResults: newPending,
          sessionSnapshots: state.sessionId
            ? {
                ...state.sessionSnapshots,
                [state.sessionId]: {
                  messages,
                  toolCalls: nextCalls,
                  streamMessageId: targetMessageId ?? state.currentStreamMessageId,
                  isStreaming: state.isStreaming,
                },
              }
            : state.sessionSnapshots,
        };
      }

      const nextCalls = shouldReset ? [callWithMeta] : [...state.currentToolCalls, callWithMeta];
      return {
        messages,
        currentToolCalls: nextCalls,
        currentStreamMessageId: targetMessageId ?? state.currentStreamMessageId,
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages,
                toolCalls: nextCalls,
                streamMessageId: targetMessageId ?? state.currentStreamMessageId,
                isStreaming: state.isStreaming,
              },
            }
          : state.sessionSnapshots,
      };
    }),

  updateToolResult: (id, result) =>
    set((state) => {
      // Check if the tool call exists
      const callExists = state.currentToolCalls.some((call) => call.id === id);

      // If tool call doesn't exist yet, buffer the result for later
      if (!callExists) {
        const newPending = new Map(state.pendingToolResults);
        newPending.set(id, result);
        return {
          pendingToolResults: newPending,
        };
      }

      // Tool call exists, update it directly
      return {
        currentToolCalls: state.currentToolCalls.map((call) =>
          call.id === id ? { ...call, result } : call
        ),
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages: state.messages,
                toolCalls: state.currentToolCalls.map((call) =>
                  call.id === id ? { ...call, result } : call
                ),
                streamMessageId: state.currentStreamMessageId,
                isStreaming: state.isStreaming,
              },
            }
          : state.sessionSnapshots,
      };
    }),

  finalizeToolCalls: (messageId) =>
    set((state) => {
      if (state.currentToolCalls.length === 0) {
        return {
          ...state,
          currentStreamMessageId: null,
          sessionSnapshots: state.sessionId
            ? {
                ...state.sessionSnapshots,
                [state.sessionId]: {
                  messages: state.messages,
                  toolCalls: state.currentToolCalls,
                  streamMessageId: null,
                  isStreaming: state.isStreaming,
                },
              }
            : state.sessionSnapshots,
        };
      }

      const messages = [...state.messages];
      const targetMessageId = messageId ?? state.currentStreamMessageId;
      let foundMessage = false;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'assistant' && (!targetMessageId || messages[i].id === targetMessageId)) {
          const toolResults = (state.currentToolCalls as Array<ToolCall & { result?: ToolResult }>)
            .map((call) => call.result)
            .filter((result): result is ToolResult => Boolean(result));
          messages[i] = {
            ...messages[i],
            toolCalls: state.currentToolCalls,
            toolResults: toolResults.length > 0 ? toolResults : undefined,
          };
          foundMessage = true;
          break;
        }
      }

      // If no assistant message was found (tool-only response), create a placeholder
      if (!foundMessage) {
        const toolResults = (state.currentToolCalls as Array<ToolCall & { result?: ToolResult }>)
          .map((call) => call.result)
          .filter((result): result is ToolResult => Boolean(result));
        const newId = targetMessageId ?? generateId();
        messages.push({
          id: newId,
          role: 'assistant',
          content: '',
          timestamp: now(),
          toolCalls: state.currentToolCalls,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
        });
      }

      return {
        messages,
        currentStreamMessageId: null,
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages,
                toolCalls: state.currentToolCalls,
                streamMessageId: null,
                isStreaming: state.isStreaming,
              },
            }
          : state.sessionSnapshots,
      };
    }),

  clearToolCalls: () =>
    set((state) => ({
      currentToolCalls: [],
      currentStreamMessageId: null,
      pendingToolResults: new Map(),
      sessionSnapshots: state.sessionId
        ? {
            ...state.sessionSnapshots,
            [state.sessionId]: {
              messages: state.messages,
              toolCalls: [],
              streamMessageId: null,
              isStreaming: state.isStreaming,
            },
          }
        : state.sessionSnapshots,
    })),

  clearMessages: () =>
    set((state) => ({
      isStreaming: false,
      messages: [],
      currentToolCalls: [],
      currentStreamMessageId: null,
      pendingToolResults: new Map(),
      sessionSnapshots: state.sessionId
        ? {
            ...state.sessionSnapshots,
            [state.sessionId]: {
              messages: [],
              toolCalls: [],
              streamMessageId: null,
              isStreaming: false,
            },
          }
        : state.sessionSnapshots,
    })),

  clearAll: () =>
    set({
      messages: [],
      isStreaming: false,
      currentToolCalls: [],
      currentStreamMessageId: null,
      sessionId: null,
      sessions: [],
      sessionSnapshots: {},
      pendingToolResults: new Map(),
      listeningDraft: '',
      isListening: false,
    }),
}));

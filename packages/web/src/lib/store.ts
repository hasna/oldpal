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
  sessionSnapshots: Record<string, { messages: Message[]; toolCalls: ToolCallWithMeta[]; streamMessageId: string | null; isStreaming: boolean }>;

  setSessionId: (sessionId: string) => void;
  createSession: (label?: string) => string;
  switchSession: (sessionId: string) => void;
  addMessage: (message: Message) => void;
  appendMessageContent: (id: string | undefined, content: string) => void;
  setStreaming: (streaming: boolean) => void;
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
          isStreaming: state.isStreaming,
        };
      }
      const snapshot = snapshots[sessionId] || { messages: [], toolCalls: [], streamMessageId: null, isStreaming: false };
      return {
        sessionId,
        isStreaming: snapshot.isStreaming,
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
      let updated = false;
      let streamId: string | null = null;
      if (id) {
        let matchIndex = -1;
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          if (matchIndex === -1 && messages[i].id === id && messages[i].role === 'assistant') {
            matchIndex = i;
          }
        }
        if (matchIndex >= 0) {
          messages[matchIndex] = { ...messages[matchIndex], content: messages[matchIndex].content + content };
          updated = true;
          streamId = id;
        }
      }
      if (!updated) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          messages[messages.length - 1] = { ...lastMessage, content: lastMessage.content + content };
          streamId = lastMessage.id;
        } else {
          const newId = id ?? generateId();
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
      sessionSnapshots: state.sessionId
        ? {
            ...state.sessionSnapshots,
            [state.sessionId]: {
              ...state.sessionSnapshots[state.sessionId],
              isStreaming: streaming,
            },
          }
        : state.sessionSnapshots,
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
    set((state) => ({
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
    })),

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
    }),
}));

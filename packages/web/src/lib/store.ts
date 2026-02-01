import { create } from 'zustand';
import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentToolCalls: ToolCall[];
  currentToolMessageId: string | null;
  sessionId: string | null;
  sessions: Array<{ id: string; label: string; createdAt: number }>;
  sessionSnapshots: Record<string, { messages: Message[]; toolCalls: ToolCall[]; toolMessageId: string | null }>;

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
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentToolCalls: [],
  currentToolMessageId: null,
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
      currentToolMessageId: null,
      sessionSnapshots: {
        ...state.sessionSnapshots,
        [id]: { messages: [], toolCalls: [], toolMessageId: null },
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
          toolMessageId: state.currentToolMessageId,
        };
      }
      const snapshot = snapshots[sessionId] || { messages: [], toolCalls: [], toolMessageId: null };
      return {
        sessionId,
        isStreaming: false,
        messages: snapshot.messages,
        currentToolCalls: snapshot.toolCalls,
        currentToolMessageId: snapshot.toolMessageId ?? null,
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
            },
          }
        : state.sessionSnapshots,
    })),

  appendMessageContent: (id, content) =>
    set((state) => {
      const messages = [...state.messages];
      let updated = false;
      if (id) {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          if (messages[i].id === id && messages[i].role === 'assistant') {
            messages[i] = { ...messages[i], content: messages[i].content + content };
            updated = true;
            break;
          }
        }
      }
      if (!updated) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          lastMessage.content += content;
        }
      }
      return {
        messages,
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages,
                toolCalls: state.currentToolCalls,
                toolMessageId: state.currentToolMessageId,
              },
            }
          : state.sessionSnapshots,
      };
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  addToolCall: (call, messageId) =>
    set((state) => {
      const targetMessageId = messageId ?? state.currentToolMessageId;
      const shouldReset = targetMessageId && targetMessageId !== state.currentToolMessageId;
      const nextCalls = shouldReset ? [call] : [...state.currentToolCalls, call];
      return {
        currentToolCalls: nextCalls,
        currentToolMessageId: targetMessageId ?? state.currentToolMessageId,
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages: state.messages,
                toolCalls: nextCalls,
                toolMessageId: targetMessageId ?? state.currentToolMessageId,
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
              toolMessageId: state.currentToolMessageId,
            },
          }
        : state.sessionSnapshots,
    })),

  finalizeToolCalls: (messageId) =>
    set((state) => {
      if (state.currentToolCalls.length === 0) {
        return state;
      }

      const messages = [...state.messages];
      const targetMessageId = messageId ?? state.currentToolMessageId;
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
          break;
        }
      }

      return {
        messages,
        currentToolMessageId: null,
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages,
                toolCalls: state.currentToolCalls,
                toolMessageId: null,
              },
            }
          : state.sessionSnapshots,
      };
    }),

  clearToolCalls: () =>
    set((state) => ({
      currentToolCalls: [],
      currentToolMessageId: null,
      sessionSnapshots: state.sessionId
        ? {
            ...state.sessionSnapshots,
            [state.sessionId]: {
              messages: state.messages,
              toolCalls: [],
              toolMessageId: null,
            },
          }
        : state.sessionSnapshots,
    })),

  clearMessages: () =>
    set((state) => ({
      isStreaming: false,
      messages: [],
      currentToolCalls: [],
      sessionSnapshots: state.sessionId
        ? {
            ...state.sessionSnapshots,
            [state.sessionId]: {
              messages: [],
              toolCalls: [],
            },
          }
        : state.sessionSnapshots,
    })),
}));

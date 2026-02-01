import { create } from 'zustand';
import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentToolCalls: ToolCall[];
  sessionId: string | null;
  sessions: Array<{ id: string; label: string; createdAt: number }>;
  sessionSnapshots: Record<string, { messages: Message[]; toolCalls: ToolCall[] }>;

  setSessionId: (sessionId: string) => void;
  createSession: (label?: string) => string;
  switchSession: (sessionId: string) => void;
  addMessage: (message: Message) => void;
  updateLastMessage: (content: string) => void;
  setStreaming: (streaming: boolean) => void;
  addToolCall: (call: ToolCall) => void;
  updateToolResult: (id: string, result: ToolResult) => void;
  finalizeToolCalls: () => void;
  clearToolCalls: () => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentToolCalls: [],
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
      sessionSnapshots: {
        ...state.sessionSnapshots,
        [id]: { messages: [], toolCalls: [] },
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
        };
      }
      const snapshot = snapshots[sessionId] || { messages: [], toolCalls: [] };
      return {
        sessionId,
        isStreaming: false,
        messages: snapshot.messages,
        currentToolCalls: snapshot.toolCalls,
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

  updateLastMessage: (content) =>
    set((state) => {
      const messages = [...state.messages];
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        lastMessage.content += content;
      }
      return {
        messages,
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages,
                toolCalls: state.currentToolCalls,
              },
            }
          : state.sessionSnapshots,
      };
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  addToolCall: (call) =>
    set((state) => ({
      currentToolCalls: [...state.currentToolCalls, call],
      sessionSnapshots: state.sessionId
        ? {
            ...state.sessionSnapshots,
            [state.sessionId]: {
              messages: state.messages,
              toolCalls: [...state.currentToolCalls, call],
            },
          }
        : state.sessionSnapshots,
    })),

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
            },
          }
        : state.sessionSnapshots,
    })),

  finalizeToolCalls: () =>
    set((state) => {
      if (state.currentToolCalls.length === 0) {
        return state;
      }

      const messages = [...state.messages];
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'assistant') {
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
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages,
                toolCalls: state.currentToolCalls,
              },
            }
          : state.sessionSnapshots,
      };
    }),

  clearToolCalls: () =>
    set((state) => ({
      currentToolCalls: [],
      sessionSnapshots: state.sessionId
        ? {
            ...state.sessionSnapshots,
            [state.sessionId]: {
              messages: state.messages,
              toolCalls: [],
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

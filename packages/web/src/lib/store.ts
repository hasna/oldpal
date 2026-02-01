import { create } from 'zustand';
import type { Message, ToolCall, ToolResult } from '@oldpal/shared';

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

  clearToolCalls: () => set({ currentToolCalls: [] }),

  clearMessages: () => set({ messages: [], currentToolCalls: [] }),
}));

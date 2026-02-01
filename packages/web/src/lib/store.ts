import { create } from 'zustand';
import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';

type ToolCallWithMeta = ToolCall & { result?: ToolResult; startedAt?: number };

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentToolCalls: ToolCallWithMeta[];
  currentStreamMessageId: string | null;
  sessionId: string | null;
  sessions: Array<{ id: string; label: string; createdAt: number }>;
  sessionSnapshots: Record<string, { messages: Message[]; toolCalls: ToolCallWithMeta[]; streamMessageId: string | null }>;

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
        [id]: { messages: [], toolCalls: [], streamMessageId: null },
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
        };
      }
      const snapshot = snapshots[sessionId] || { messages: [], toolCalls: [], streamMessageId: null };
      return {
        sessionId,
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
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          if (messages[i].id === id && messages[i].role === 'assistant') {
            messages[i] = { ...messages[i], content: messages[i].content + content };
            updated = true;
            streamId = id;
            break;
          }
        }
      }
      if (!updated) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          lastMessage.content += content;
          streamId = lastMessage.id;
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
              },
            }
          : state.sessionSnapshots,
      };
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  addToolCall: (call, messageId) =>
    set((state) => {
      const targetMessageId = messageId ?? state.currentStreamMessageId;
      const shouldReset = targetMessageId && targetMessageId !== state.currentStreamMessageId;
      const callWithMeta: ToolCallWithMeta = { ...call, startedAt: Date.now() };
      const nextCalls = shouldReset ? [callWithMeta] : [...state.currentToolCalls, callWithMeta];
      return {
        currentToolCalls: nextCalls,
        currentStreamMessageId: targetMessageId ?? state.currentStreamMessageId,
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages: state.messages,
                toolCalls: nextCalls,
                streamMessageId: targetMessageId ?? state.currentStreamMessageId,
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
      const targetMessageId = messageId ?? state.currentStreamMessageId;
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
        currentStreamMessageId: null,
        sessionSnapshots: state.sessionId
          ? {
              ...state.sessionSnapshots,
              [state.sessionId]: {
                messages,
                toolCalls: state.currentToolCalls,
                streamMessageId: null,
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

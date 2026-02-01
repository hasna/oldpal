export type ClientMessage =
  | { type: 'message'; content: string; sessionId?: string; messageId?: string }
  | { type: 'cancel'; sessionId?: string }
  | { type: 'session'; sessionId: string };

export type ServerMessage =
  | { type: 'text_delta'; content: string; messageId?: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown; messageId?: string }
  | { type: 'tool_result'; id: string; output: string; isError: boolean; messageId?: string }
  | { type: 'message_complete'; messageId?: string }
  | { type: 'error'; message: string; messageId?: string };

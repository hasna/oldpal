export type ClientMessage =
  | { type: 'message'; content: string; sessionId?: string }
  | { type: 'cancel'; sessionId?: string }
  | { type: 'session'; sessionId: string };

export type ServerMessage =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'message_complete' }
  | { type: 'error'; message: string };

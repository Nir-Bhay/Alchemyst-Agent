// ─────────────────────────────────────────────────────────────────────────────
// Protocol types — mirror the server's types in June-2026_FullStackAI/agent-server/src/types.ts.
//
// These are kept in lockstep with the server. The server is the source of truth;
// we do not modify it, only consume it. If the server adds a new message variant,
// we extend the discriminated union here and the validators in ./validators.ts.
// ─────────────────────────────────────────────────────────────────────────────

// ── Server → Client ──────────────────────────────────────────────────────────

export interface TokenMessage {
  readonly type: "TOKEN";
  readonly seq: number;
  readonly text: string;
  readonly stream_id: string;
}

export interface ToolCallMessage {
  readonly type: "TOOL_CALL";
  readonly seq: number;
  readonly call_id: string;
  readonly tool_name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly stream_id: string;
}

export interface ToolResultMessage {
  readonly type: "TOOL_RESULT";
  readonly seq: number;
  readonly call_id: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly stream_id: string;
}

export interface ContextSnapshotMessage {
  readonly type: "CONTEXT_SNAPSHOT";
  readonly seq: number;
  readonly context_id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface PingMessage {
  readonly type: "PING";
  readonly seq: number;
  readonly challenge: string;
}

export interface StreamEndMessage {
  readonly type: "STREAM_END";
  readonly seq: number;
  readonly stream_id: string;
}

export interface ErrorMessage {
  readonly type: "ERROR";
  readonly seq: number;
  readonly code: string;
  readonly message: string;
}

export type ServerMessage =
  | TokenMessage
  | ToolCallMessage
  | ToolResultMessage
  | ContextSnapshotMessage
  | PingMessage
  | StreamEndMessage
  | ErrorMessage;

// ── Client → Server ──────────────────────────────────────────────────────────

export interface UserMessagePayload {
  readonly type: "USER_MESSAGE";
  readonly content: string;
}

export interface PongPayload {
  readonly type: "PONG";
  readonly echo: string;
}

export interface ResumePayload {
  readonly type: "RESUME";
  readonly last_seq: number;
}

export interface ToolAckPayload {
  readonly type: "TOOL_ACK";
  readonly call_id: string;
}

export type ClientMessage = UserMessagePayload | PongPayload | ResumePayload | ToolAckPayload;

// ── Tagged helpers ───────────────────────────────────────────────────────────

export type ServerMessageType = ServerMessage["type"];
export type ClientMessageType = ClientMessage["type"];

// Sequence numbers are non-negative integers.
export type Seq = number;

// ── Wire envelope metadata (not in the server types but inlined into actions) ─

export interface WireMeta {
  readonly receivedAt: number;
}

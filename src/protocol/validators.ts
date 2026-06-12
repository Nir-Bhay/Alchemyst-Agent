// ─────────────────────────────────────────────────────────────────────────────
// validators.ts
//
// *** ESCAPE HATCH FILE — the ONE place where `unknown` and structural runtime
//     validation are acceptable. ***
//
// Every value coming off the WebSocket is `unknown` JSON. The TypeScript type
// system cannot statically prove that a parsed object actually matches our
// `ServerMessage` union — a hostile or buggy server (the assignment explicitly
// includes chaos mode that "sends malformed heartbeats") could send us
// almost-anything. We need a runtime gate that:
//
//   1. Rejects messages that are not well-formed, returning a tagged result
//      (`ok` with the typed message, or `invalid` with the reason) instead of
//      throwing — chaos is the *expected* environment, not a surprise.
//
//   2. Produces *typed* `ServerMessage` values on the success path so the
//      rest of the codebase never has to deal with `unknown` again. This is
//      why we accept a one-file escape hatch in exchange for end-to-end
//      type safety everywhere else.
//
//   3. Defends against the specific failure modes called out in the spec:
//      - missing `seq`  → reject
//      - missing fields  → reject
//      - wrong `type`    → reject
//      - corrupt PING (empty challenge) → ACCEPT (the spec says we must
//        not crash on these; we still echo the empty string back).
//
// There is NO `any` here. All reads are narrowed through `typeof`, `in`, and
// property existence checks. The return type is a *discriminated* result
// (`{ok: true, value: ServerMessage} | {ok: false, reason: string}`) so
// callers must explicitly handle both branches.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ClientMessage,
  ContextSnapshotMessage,
  ErrorMessage,
  PingMessage,
  ServerMessage,
  StreamEndMessage,
  TokenMessage,
  ToolAckPayload,
  ToolCallMessage,
  ToolResultMessage,
  UserMessagePayload,
  PongPayload,
  ResumePayload,
} from "./types";

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

// ── Server message validation ────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function readField<T>(
  obj: Record<string, unknown>,
  key: string,
  check: (v: unknown) => v is T,
  typeName: string,
): T | null {
  if (!(key in obj)) {
    return null;
  }
  const v = obj[key];
  if (!check(v)) {
    return null;
  }
  return v;
}

function validateToken(obj: Record<string, unknown>): ValidationResult<TokenMessage> {
  const seq = readField(obj, "seq", isNonNegativeInteger, "number");
  if (seq === null) return { ok: false, reason: "TOKEN: missing/invalid seq" };
  const text = readField(obj, "text", isString, "string");
  if (text === null) return { ok: false, reason: "TOKEN: missing/invalid text" };
  const streamId = readField(obj, "stream_id", isString, "string");
  if (streamId === null) return { ok: false, reason: "TOKEN: missing/invalid stream_id" };
  return {
    ok: true,
    value: { type: "TOKEN", seq, text, stream_id: streamId },
  };
}

function validateToolCall(obj: Record<string, unknown>): ValidationResult<ToolCallMessage> {
  const seq = readField(obj, "seq", isNonNegativeInteger, "number");
  if (seq === null) return { ok: false, reason: "TOOL_CALL: missing/invalid seq" };
  const callId = readField(obj, "call_id", isString, "string");
  if (callId === null) return { ok: false, reason: "TOOL_CALL: missing/invalid call_id" };
  const toolName = readField(obj, "tool_name", isString, "string");
  if (toolName === null) return { ok: false, reason: "TOOL_CALL: missing/invalid tool_name" };
  const streamId = readField(obj, "stream_id", isString, "string");
  if (streamId === null) return { ok: false, reason: "TOOL_CALL: missing/invalid stream_id" };
  const args = obj["args"];
  if (args !== undefined && !isRecord(args) && !Array.isArray(args)) {
    return { ok: false, reason: "TOOL_CALL: args must be object/array" };
  }
  const argsRecord: Readonly<Record<string, unknown>> = isRecord(args) ? args : {};
  return {
    ok: true,
    value: {
      type: "TOOL_CALL",
      seq,
      call_id: callId,
      tool_name: toolName,
      args: argsRecord,
      stream_id: streamId,
    },
  };
}

function validateToolResult(obj: Record<string, unknown>): ValidationResult<ToolResultMessage> {
  const seq = readField(obj, "seq", isNonNegativeInteger, "number");
  if (seq === null) return { ok: false, reason: "TOOL_RESULT: missing/invalid seq" };
  const callId = readField(obj, "call_id", isString, "string");
  if (callId === null) return { ok: false, reason: "TOOL_RESULT: missing/invalid call_id" };
  const streamId = readField(obj, "stream_id", isString, "string");
  if (streamId === null) return { ok: false, reason: "TOOL_RESULT: missing/invalid stream_id" };
  const result = obj["result"];
  if (result !== undefined && !isRecord(result) && !Array.isArray(result)) {
    return { ok: false, reason: "TOOL_RESULT: result must be object/array" };
  }
  const resultRecord: Readonly<Record<string, unknown>> = isRecord(result) ? result : {};
  return {
    ok: true,
    value: {
      type: "TOOL_RESULT",
      seq,
      call_id: callId,
      result: resultRecord,
      stream_id: streamId,
    },
  };
}

function validateContextSnapshot(
  obj: Record<string, unknown>,
): ValidationResult<ContextSnapshotMessage> {
  const seq = readField(obj, "seq", isNonNegativeInteger, "number");
  if (seq === null) return { ok: false, reason: "CONTEXT_SNAPSHOT: missing/invalid seq" };
  const contextId = readField(obj, "context_id", isString, "string");
  if (contextId === null) return { ok: false, reason: "CONTEXT_SNAPSHOT: missing/invalid context_id" };
  const data = obj["data"];
  // data must be a record per server types, but we accept arrays defensively
  // because chaos can produce unusual payloads. We treat anything that isn't
  // an object as an empty record — the caller can still render a placeholder.
  const dataRecord: Readonly<Record<string, unknown>> = isRecord(data)
    ? data
    : Array.isArray(data)
      ? { items: data }
      : {};
  return {
    ok: true,
    value: { type: "CONTEXT_SNAPSHOT", seq, context_id: contextId, data: dataRecord },
  };
}

function validatePing(obj: Record<string, unknown>): ValidationResult<PingMessage> {
  const seq = readField(obj, "seq", isNonNegativeInteger, "number");
  if (seq === null) return { ok: false, reason: "PING: missing/invalid seq" };
  // Per the spec, chaos mode can send PINGs with an empty `challenge`.
  // We accept that and return whatever string the server sent (possibly "").
  // `challenge` may also be missing; we default to "".
  const challenge = readField(obj, "challenge", isString, "string");
  return {
    ok: true,
    value: { type: "PING", seq, challenge: challenge ?? "" },
  };
}

function validateStreamEnd(obj: Record<string, unknown>): ValidationResult<StreamEndMessage> {
  const seq = readField(obj, "seq", isNonNegativeInteger, "number");
  if (seq === null) return { ok: false, reason: "STREAM_END: missing/invalid seq" };
  const streamId = readField(obj, "stream_id", isString, "string");
  if (streamId === null) return { ok: false, reason: "STREAM_END: missing/invalid stream_id" };
  return { ok: true, value: { type: "STREAM_END", seq, stream_id: streamId } };
}

function validateError(obj: Record<string, unknown>): ValidationResult<ErrorMessage> {
  const seq = readField(obj, "seq", isNonNegativeInteger, "number");
  if (seq === null) return { ok: false, reason: "ERROR: missing/invalid seq" };
  const code = readField(obj, "code", isString, "string");
  if (code === null) return { ok: false, reason: "ERROR: missing/invalid code" };
  const message = readField(obj, "message", isString, "string");
  if (message === null) return { ok: false, reason: "ERROR: missing/invalid message" };
  return { ok: true, value: { type: "ERROR", seq, code, message } };
}

/**
 * Validate raw JSON parsed off the WebSocket into a typed `ServerMessage`.
 *
 * Returns a discriminated result. Callers MUST handle the `ok: false` branch
 * (typically by logging the reason and dropping the message). The protocol
 * spec explicitly says we must not crash on malformed messages.
 */
export function validateServerMessage(raw: unknown): ValidationResult<ServerMessage> {
  if (!isRecord(raw)) {
    return { ok: false, reason: "not a JSON object" };
  }
  if (!("type" in raw) || !isString(raw["type"])) {
    return { ok: false, reason: "missing/invalid type field" };
  }
  const type = raw["type"];

  switch (type) {
    case "TOKEN":
      return validateToken(raw);
    case "TOOL_CALL":
      return validateToolCall(raw);
    case "TOOL_RESULT":
      return validateToolResult(raw);
    case "CONTEXT_SNAPSHOT":
      return validateContextSnapshot(raw);
    case "PING":
      return validatePing(raw);
    case "STREAM_END":
      return validateStreamEnd(raw);
    case "ERROR":
      return validateError(raw);
    default:
      return { ok: false, reason: `unknown message type: ${type}` };
  }
}

// ── Outbound client message validation (defensive) ──────────────────────────

function validateUserMessage(obj: Record<string, unknown>): ValidationResult<UserMessagePayload> {
  if (!isString(obj["content"])) {
    return { ok: false, reason: "USER_MESSAGE: missing/invalid content" };
  }
  return { ok: true, value: { type: "USER_MESSAGE", content: obj["content"] } };
}

function validatePong(obj: Record<string, unknown>): ValidationResult<PongPayload> {
  if (!isString(obj["echo"])) {
    return { ok: false, reason: "PONG: missing/invalid echo" };
  }
  return { ok: true, value: { type: "PONG", echo: obj["echo"] } };
}

function validateResume(obj: Record<string, unknown>): ValidationResult<ResumePayload> {
  const lastSeq = obj["last_seq"];
  if (!isNonNegativeInteger(lastSeq)) {
    return { ok: false, reason: "RESUME: missing/invalid last_seq" };
  }
  return { ok: true, value: { type: "RESUME", last_seq: lastSeq } };
}

function validateToolAck(obj: Record<string, unknown>): ValidationResult<ToolAckPayload> {
  if (!isString(obj["call_id"])) {
    return { ok: false, reason: "TOOL_ACK: missing/invalid call_id" };
  }
  return { ok: true, value: { type: "TOOL_ACK", call_id: obj["call_id"] } };
}

export function validateClientMessage(raw: unknown): ValidationResult<ClientMessage> {
  if (!isRecord(raw)) return { ok: false, reason: "not a JSON object" };
  if (!isString(raw["type"])) return { ok: false, reason: "missing type" };
  switch (raw["type"]) {
    case "USER_MESSAGE":
      return validateUserMessage(raw);
    case "PONG":
      return validatePong(raw);
    case "RESUME":
      return validateResume(raw);
    case "TOOL_ACK":
      return validateToolAck(raw);
    default:
      return { ok: false, reason: `unknown client message type: ${raw["type"]}` };
  }
}

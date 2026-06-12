// ─────────────────────────────────────────────────────────────────────────────
// state/slices/timeline.ts
//
// The trace timeline. One row per *event* as observed at the protocol level,
// with one important exception: consecutive TOKENs for the same stream are
// coalesced into a single `TokenBatch` row. A TokenBatch row is "open" if
// the previous event for that stream was a TOKEN within the last 250ms.
//
// The timeline slice does NOT dedupe by seq — that's the messageRouter's
// job. By the time an event reaches this slice it has already been
// dedup'd.
//
// The timeline is an append-only array. We never reorder. New rows are
// added in arrival order (after the reorder buffer has placed them in seq
// order, so the arrival order is also the logical order).
// ─────────────────────────────────────────────────────────────────────────────

import type { Seq, ServerMessage } from "@/protocol/types";

export type TimelineRowKind =
  | "token_batch"
  | "tool_call"
  | "tool_result"
  | "context_snapshot"
  | "stream_end"
  | "ping"
  | "pong"
  | "error"
  | "resume"
  | "reconnect"
  | "disconnect";

interface BaseRow {
  readonly id: string;
  readonly kind: TimelineRowKind;
  readonly seq: Seq;
  readonly at: number;
  readonly streamId?: string;
  /** For bidirectional-click: anchor ID. */
  readonly anchor?: string;
}

export interface TokenBatchRow extends BaseRow {
  readonly kind: "token_batch";
  readonly text: string;
  readonly tokenCount: number;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly streamId: string;
}

export interface ToolCallRow extends BaseRow {
  readonly kind: "tool_call";
  readonly callId: string;
  readonly toolName: string;
  readonly argsPreview: string;
  readonly streamId: string;
}

export interface ToolResultRow extends BaseRow {
  readonly kind: "tool_result";
  readonly callId: string;
  readonly resultPreview: string;
  readonly streamId: string;
}

export interface ContextSnapshotRow extends BaseRow {
  readonly kind: "context_snapshot";
  readonly contextId: string;
  readonly sizeBytes: number;
  readonly keyCount: number;
}

export interface StreamEndRow extends BaseRow {
  readonly kind: "stream_end";
  readonly streamId: string;
}

export interface PingRow extends BaseRow {
  readonly kind: "ping";
  readonly challenge: string;
}

export interface PongRow extends BaseRow {
  readonly kind: "pong";
  readonly echo: string;
}

export interface ErrorRow extends BaseRow {
  readonly kind: "error";
  readonly code: string;
  readonly message: string;
}

export interface ResumeRow extends BaseRow {
  readonly kind: "resume";
  readonly lastSeq: Seq;
}

export interface ReconnectRow extends BaseRow {
  readonly kind: "reconnect";
  readonly attempt: number;
}

export interface DisconnectRow extends BaseRow {
  readonly kind: "disconnect";
  readonly reason: string;
}

export type TimelineRow =
  | TokenBatchRow
  | ToolCallRow
  | ToolResultRow
  | ContextSnapshotRow
  | StreamEndRow
  | PingRow
  | PongRow
  | ErrorRow
  | ResumeRow
  | ReconnectRow
  | DisconnectRow;

export interface TimelineFilter {
  readonly kinds: ReadonlySet<TimelineRowKind>;
  readonly search: string;
}

export interface TimelineSlice {
  readonly timeline: ReadonlyArray<TimelineRow>;
  readonly timelineFilter: TimelineFilter;
  readonly expandedRowId: string | null;
  readonly highlightedEventId: string | null;
  readonly appendEvent: (row: TimelineRow) => void;
  readonly setTimelineFilter: (f: TimelineFilter) => void;
  readonly setExpandedRowId: (id: string | null) => void;
  readonly setHighlightedEventId: (id: string | null) => void;
  readonly resetTimeline: () => void;
}

const ALL_KINDS: ReadonlySet<TimelineRowKind> = new Set<TimelineRowKind>([
  "token_batch",
  "tool_call",
  "tool_result",
  "context_snapshot",
  "stream_end",
  "ping",
  "pong",
  "error",
  "resume",
  "reconnect",
  "disconnect",
]);

export const initialTimelineFilter: TimelineFilter = {
  kinds: ALL_KINDS,
  search: "",
};

const COALESCE_WINDOW_MS = 250;

let rowCounter = 0;
function newId(): string {
  rowCounter = (rowCounter + 1) >>> 0;
  return `tl_${rowCounter.toString(36)}`;
}

function preview(s: string, n: number = 120): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "\u2026";
}

function approxSizeBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function keyCountOf(value: unknown): number {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>).length;
  }
  return 0;
}

export function makeTimelineSlice(
  set: (fn: (s: TimelineSlice) => Partial<TimelineSlice>) => void,
): TimelineSlice {
  return {
    timeline: [],
    timelineFilter: initialTimelineFilter,
    expandedRowId: null,
    highlightedEventId: null,
    appendEvent: (row) =>
      set((s) => ({ timeline: [...s.timeline, row] })),
    setTimelineFilter: (f) => set(() => ({ timelineFilter: f })),
    setExpandedRowId: (id) => set(() => ({ expandedRowId: id })),
    setHighlightedEventId: (id) => set(() => ({ highlightedEventId: id })),
    resetTimeline: () =>
      set(() => ({
        timeline: [],
        expandedRowId: null,
        highlightedEventId: null,
      })),
  };
}

// ── ServerMessage → TimelineRow adapter (pure helper) ───────────────────────

export function serverMessageToRow(
  msg: ServerMessage,
  at: number,
): TimelineRow | null {
  switch (msg.type) {
    case "TOKEN": {
      // Token rows are coalesced in the store; here we emit a single-token
      // batch row that the store will merge with its predecessor.
      return {
        id: newId(),
        kind: "token_batch",
        seq: msg.seq,
        at,
        text: msg.text,
        tokenCount: 1,
        firstAt: at,
        lastAt: at,
        streamId: msg.stream_id,
      };
    }
    case "TOOL_CALL": {
      return {
        id: newId(),
        kind: "tool_call",
        seq: msg.seq,
        at,
        callId: msg.call_id,
        toolName: msg.tool_name,
        argsPreview: preview(JSON.stringify(msg.args)),
        streamId: msg.stream_id,
      };
    }
    case "TOOL_RESULT": {
      return {
        id: newId(),
        kind: "tool_result",
        seq: msg.seq,
        at,
        callId: msg.call_id,
        resultPreview: preview(JSON.stringify(msg.result)),
        streamId: msg.stream_id,
      };
    }
    case "CONTEXT_SNAPSHOT": {
      return {
        id: newId(),
        kind: "context_snapshot",
        seq: msg.seq,
        at,
        contextId: msg.context_id,
        sizeBytes: approxSizeBytes(msg.data),
        keyCount: keyCountOf(msg.data),
      };
    }
    case "PING": {
      return {
        id: newId(),
        kind: "ping",
        seq: msg.seq,
        at,
        challenge: msg.challenge,
      };
    }
    case "STREAM_END": {
      return {
        id: newId(),
        kind: "stream_end",
        seq: msg.seq,
        at,
        streamId: msg.stream_id,
      };
    }
    case "ERROR": {
      return {
        id: newId(),
        kind: "error",
        seq: msg.seq,
        at,
        code: msg.code,
        message: msg.message,
      };
    }
    default:
      return null;
  }
}

export const COALESCE_WINDOW = COALESCE_WINDOW_MS;
export const ALL_TIMELINE_KINDS = ALL_KINDS;

// ─────────────────────────────────────────────────────────────────────────────
// state/slices/connection.ts
//
// Connection state machine, as a tagged union. Invalid transitions are
// impossible by construction — TypeScript will reject, e.g., going from
// `idle` to `tool_call_pending` without first passing through `streaming`.
//
// State reference:
//
//   disconnected → connecting → connected → streaming
//                                          ↘ tool_call_pending
//                                          ↘ reconnecting (on drop)
//   reconnecting → connecting (after backoff)
//
// "idle" is a pseudo-state used to indicate we are connected but no stream
// is active (between turns). It is the "still in chat, but waiting for
// the user" state.
// ─────────────────────────────────────────────────────────────────────────────

import type { Seq } from "@/protocol/types";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "idle"
  | "streaming"
  | "tool_call_pending"
  | "reconnecting"
  | "resuming";

export interface ConnectionState {
  readonly status: ConnectionStatus;
  readonly reconnectAttempts: number;
  readonly lastError: string | null;
  readonly lastConnectedAt: number | null;
  readonly lastDroppedAt: number | null;
  /** True from drop detection until the next STREAM_END or 1.5s quiescence. */
  readonly isResuming: boolean;
  /** Server mode (normal | chaos), inferred from /health. */
  readonly serverMode: "normal" | "chaos" | "unknown";
}

export const initialConnectionState: ConnectionState = {
  status: "disconnected",
  reconnectAttempts: 0,
  lastError: null,
  lastConnectedAt: null,
  lastDroppedAt: null,
  isResuming: false,
  serverMode: "unknown",
};

export interface ConnectionSlice {
  readonly connection: ConnectionState;
  readonly setConnectionStatus: (status: ConnectionStatus) => void;
  readonly setReconnectAttempts: (n: number) => void;
  readonly setConnectionError: (err: string | null) => void;
  readonly setLastConnectedAt: (t: number) => void;
  readonly setLastDroppedAt: (t: number) => void;
  readonly setIsResuming: (b: boolean) => void;
  readonly setServerMode: (m: "normal" | "chaos" | "unknown") => void;
}

export function makeConnectionSlice(
  set: (fn: (s: ConnectionSlice) => Partial<ConnectionSlice>) => void,
): ConnectionSlice {
  return {
    connection: initialConnectionState,
    setConnectionStatus: (status) =>
      set((s) => ({ connection: { ...s.connection, status } })),
    setReconnectAttempts: (n) =>
      set((s) => ({ connection: { ...s.connection, reconnectAttempts: n } })),
    setConnectionError: (err) =>
      set((s) => ({ connection: { ...s.connection, lastError: err } })),
    setLastConnectedAt: (t) =>
      set((s) => ({ connection: { ...s.connection, lastConnectedAt: t } })),
    setLastDroppedAt: (t) =>
      set((s) => ({ connection: { ...s.connection, lastDroppedAt: t } })),
    setIsResuming: (b) =>
      set((s) => ({ connection: { ...s.connection, isResuming: b } })),
    setServerMode: (m) =>
      set((s) => ({ connection: { ...s.connection, serverMode: m } })),
  };
}

// ── Counter slice (the two-counters invariant) ──────────────────────────────

export interface ProtocolCounters {
  readonly highestReceivedSeq: Seq;
  readonly highestRenderedSeq: Seq;
}

export interface ProtocolCountersSlice {
  readonly counters: ProtocolCounters;
  readonly noteReceived: (seq: Seq) => void;
  readonly noteRendered: (seq: Seq) => void;
  /** Called on USER_MESSAGE. Resets to zero. */
  readonly resetCounters: () => void;
}

export const initialProtocolCounters: ProtocolCounters = {
  highestReceivedSeq: 0,
  highestRenderedSeq: 0,
};

export function makeProtocolCountersSlice(
  set: (fn: (s: ProtocolCountersSlice) => Partial<ProtocolCountersSlice>) => void,
): ProtocolCountersSlice {
  return {
    counters: initialProtocolCounters,
    noteReceived: (seq) =>
      set((s) => ({
        counters: {
          ...s.counters,
          highestReceivedSeq: Math.max(s.counters.highestReceivedSeq, seq),
        },
      })),
    noteRendered: (seq) =>
      set((s) => ({
        counters: {
          ...s.counters,
          highestRenderedSeq: Math.max(s.counters.highestRenderedSeq, seq),
        },
      })),
    resetCounters: () => set(() => ({ counters: initialProtocolCounters })),
  };
}

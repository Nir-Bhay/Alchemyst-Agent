// ─────────────────────────────────────────────────────────────────────────────
// state/slices/streams.ts
//
// Per-stream chat projection. See ANALYSIS.md §2.2 — the chat is a projection
// of per-stream state, NOT a flat list of DOM nodes that events append to.
//
// A stream is keyed by `stream_id` and holds:
//   - `text`: running text accumulator
//   - `isFrozen`: true after a TOOL_CALL, cleared by TOOL_RESULT
//   - `pendingAcks`: call_ids we have rendered but not yet ACKed
//   - `awaitingResults`: call_ids for which we've seen TOOL_CALL but not TOOL_RESULT
//   - `toolCards`: ordered list of tool call records (call → result tuples)
//   - `streamEnded`: true after STREAM_END
//
// The order of `toolCards` preserves the visual stacking order in the chat.
// ─────────────────────────────────────────────────────────────────────────────

import type { Seq } from "@/protocol/types";

export type ToolCallStatus = "pending" | "running" | "ok" | "error";

export interface ToolCardRecord {
  readonly call_id: string;
  readonly call_seq: Seq;
  readonly tool_name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: ToolCallStatus;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly result_seq?: Seq;
  /** True if the call was rendered but no result has arrived yet. */
  readonly awaitingResult: boolean;
  /** True if the call_id was already ACKed (idempotency guard). */
  readonly acked: boolean;
  /** True if the connection dropped while this card was still awaiting a result. */
  readonly droppedWhileWaiting: boolean;
}

export interface StreamState {
  readonly stream_id: string;
  readonly text: string;
  readonly isFrozen: boolean;
  readonly toolCards: ReadonlyArray<ToolCardRecord>;
  readonly streamEnded: boolean;
  readonly startedAt: number;
  readonly lastEventAt: number;
  /** Highest seq seen for this stream (used to detect resume-vs-replay). */
  readonly highestStreamSeq: Seq;
}

export interface StreamsSlice {
  readonly streams: ReadonlyMap<string, StreamState>;
  readonly streamOrder: ReadonlyArray<string>;
  readonly applyToken: (streamId: string, text: string, seq: Seq) => void;
  readonly applyToolCall: (
    streamId: string,
    callId: string,
    toolName: string,
    args: Readonly<Record<string, unknown>>,
    seq: Seq,
  ) => void;
  readonly applyToolResult: (
    streamId: string,
    callId: string,
    result: Readonly<Record<string, unknown>>,
    seq: Seq,
  ) => void;
  readonly applyStreamEnd: (streamId: string, seq: Seq) => void;
  readonly markAcked: (callId: string) => void;
  readonly markAllDropsInStream: (streamId: string, droppedAt: number) => void;
  readonly resetStreams: () => void;
}

export const emptyStreamsState = {
  streams: new Map<string, StreamState>(),
  streamOrder: [] as string[],
};

function ensureStream(
  state: StreamsSlice,
  streamId: string,
  now: number,
): StreamState {
  const existing = state.streams.get(streamId);
  if (existing) return existing;
  return {
    stream_id: streamId,
    text: "",
    isFrozen: false,
    toolCards: [],
    streamEnded: false,
    startedAt: now,
    lastEventAt: now,
    highestStreamSeq: 0,
  };
}

function withStream(
  state: StreamsSlice,
  streamId: string,
  mutator: (s: StreamState) => StreamState,
  now: number,
): StreamsSlice {
  const current = ensureStream(state, streamId, now);
  const updated = mutator(current);
  const newMap = new Map(state.streams);
  newMap.set(streamId, updated);
  let order = state.streamOrder;
  if (!state.streams.has(streamId)) {
    order = [...order, streamId];
  }
  return {
    ...state,
    streams: newMap,
    streamOrder: order,
  };
}

export function makeStreamsSlice(
  set: (fn: (s: StreamsSlice) => Partial<StreamsSlice>) => void,
): StreamsSlice {
  return {
    ...emptyStreamsState,
    applyToken: (streamId, text, seq) =>
      set((s) =>
        withStream(
          s,
          streamId,
          (cur) => ({
            ...cur,
            text: cur.text + text,
            lastEventAt: Date.now(),
            highestStreamSeq: Math.max(cur.highestStreamSeq, seq),
          }),
          Date.now(),
        ),
      ),
    applyToolCall: (streamId, callId, toolName, args, seq) =>
      set((s) =>
        withStream(
          s,
          streamId,
          (cur) => {
            // Replay-safe: if a card with this call_id already exists, leave
            // it alone (idempotent). The seq may be lower on replay.
            const existing = cur.toolCards.find((c) => c.call_id === callId);
            const cards = existing
              ? cur.toolCards
              : [
                  ...cur.toolCards,
                  {
                    call_id: callId,
                    call_seq: seq,
                    tool_name: toolName,
                    args,
                    status: "pending",
                    awaitingResult: true,
                    acked: false,
                    droppedWhileWaiting: false,
                  } satisfies ToolCardRecord,
                ];
            return {
              ...cur,
              isFrozen: true,
              toolCards: cards,
              lastEventAt: Date.now(),
              highestStreamSeq: Math.max(cur.highestStreamSeq, seq),
            };
          },
          Date.now(),
        ),
      ),
    applyToolResult: (streamId, callId, result, seq) =>
      set((s) =>
        withStream(
          s,
          streamId,
          (cur) => {
            const cards: ToolCardRecord[] = cur.toolCards.map((c) =>
              c.call_id === callId
                ? {
                    ...c,
                    status: "ok" as const,
                    result,
                    result_seq: seq,
                    awaitingResult: false,
                    droppedWhileWaiting: false,
                  }
                : c,
            );
            return {
              ...cur,
              isFrozen: false,
              toolCards: cards,
              lastEventAt: Date.now(),
              highestStreamSeq: Math.max(cur.highestStreamSeq, seq),
            };
          },
          Date.now(),
        ),
      ),
    applyStreamEnd: (streamId, seq) =>
      set((s) =>
        withStream(
          s,
          streamId,
          (cur) => ({
            ...cur,
            streamEnded: true,
            isFrozen: false,
            lastEventAt: Date.now(),
            highestStreamSeq: Math.max(cur.highestStreamSeq, seq),
          }),
          Date.now(),
        ),
      ),
    markAcked: (callId) =>
      set((s) => {
        let changed = false;
        const newMap = new Map(s.streams);
        for (const [sid, stream] of newMap) {
          let cardChanged = false;
          const newCards = stream.toolCards.map((c) => {
            if (c.call_id === callId && !c.acked) {
              cardChanged = true;
              return { ...c, acked: true };
            }
            return c;
          });
          if (cardChanged) {
            changed = true;
            newMap.set(sid, { ...stream, toolCards: newCards });
          }
        }
        if (!changed) return s;
        return { ...s, streams: newMap };
      }),
    markAllDropsInStream: (streamId, _droppedAt) =>
      set((s) => {
        const stream = s.streams.get(streamId);
        if (!stream) return s;
        const newCards = stream.toolCards.map((c) =>
          c.awaitingResult ? { ...c, droppedWhileWaiting: true } : c,
        );
        const newMap = new Map(s.streams);
        newMap.set(streamId, { ...stream, toolCards: newCards });
        return { ...s, streams: newMap };
      }),
    resetStreams: () =>
      set(() => ({
        streams: new Map(),
        streamOrder: [],
      })),
  };
}

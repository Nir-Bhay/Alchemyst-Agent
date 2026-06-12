// ─────────────────────────────────────────────────────────────────────────────
// state/store.ts
//
// Single Zustand store composed of five slices. Components subscribe via
// selectors (see ./selectors.ts) so that:
//
//   - The TimelinePanel only re-renders when timeline-relevant state changes
//     (timeline array, filter, expanded row, highlight).
//
//   - The ChatPanel only re-renders when stream-relevant state changes.
//
//   - The ConnectionIndicator only re-renders when the connection slice
//     changes.
//
//   - The ContextPanel only re-renders when contexts/activeContextId change.
//
// This is the only way to pass the "no jank at 30+ events/sec" gate for
// Task 2. A naive useState-at-the-root would re-render the entire app on
// every TOKEN.
//
// All writes happen via Zustand actions (setX). Components do not mutate
// state directly.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import { Dedup } from "@/protocol/dedup";
import { emptyBuffer } from "@/protocol/reorderBuffer";

import { makeConnectionSlice, makeProtocolCountersSlice } from "./slices/connection";
import { makeStreamsSlice } from "./slices/streams";
import { makeTimelineSlice, serverMessageToRow } from "./slices/timeline";
import { makeContextsSlice } from "./slices/contexts";
import { makeProtocolSlice } from "./slices/protocol";
import type { ConnectionSlice, ProtocolCountersSlice } from "./slices/connection";
import type { StreamsSlice } from "./slices/streams";
import type { TimelineSlice, TokenBatchRow, TimelineRow } from "./slices/timeline";
import type { ContextsSlice } from "./slices/contexts";
import type { ProtocolSlice } from "./slices/protocol";
import type { Seq, ServerMessage } from "@/protocol/types";

export type AppStore =
  & ConnectionSlice
  & ProtocolCountersSlice
  & StreamsSlice
  & TimelineSlice
  & ContextsSlice
  & ProtocolSlice
  & {
    // ── Composite actions ────────────────────────────────────────────
    /** Called by the messageRouter after each event is rendered. */
    onServerMessage: (msg: ServerMessage, at: number) => void;
    /** Called by the messageRouter on every PING immediately. */
    recordPong: (echo: string, at: number) => void;
    /** Called when the connection has just opened. */
    onConnectionOpen: (at: number) => void;
    /** Called when the connection has just dropped. */
    onConnectionDrop: (reason: string, at: number) => void;
    /** Called when the user sends a USER_MESSAGE. Resets per-turn state. */
    onUserMessage: () => void;
    /** Token batch coalescing helper (for the message router). */
    tryCoalesceToken: (streamId: string, text: string, seq: Seq, at: number) => void;
  };

// The set/get types are unified here for the slice constructors.
type SetState = (fn: (s: AppStore) => Partial<AppStore>) => void;
type GetState = () => AppStore;

// We use a small helper to satisfy the slice-constructor set() signatures.
// The slices declare their set() as a function from their own slice to a
// partial of their slice; here we adapt that to the full AppStore.
const sliceSet =
  (set: (partial: Partial<AppStore> | ((s: AppStore) => Partial<AppStore>)) => void): SetState =>
  (fn) =>
    set(fn as (s: AppStore) => Partial<AppStore>);

export const useAppStore = create<AppStore>()(
  subscribeWithSelector((set, get) => {
    const s = set as unknown as (fn: (s: AppStore) => Partial<AppStore>) => void;
    const connectionSlice = makeConnectionSlice(sliceSet(set));
    const countersSlice = makeProtocolCountersSlice(sliceSet(set));
    const streamsSlice = makeStreamsSlice(sliceSet(set));
    const timelineSlice = makeTimelineSlice(sliceSet(set));
    const contextsSlice = makeContextsSlice(sliceSet(set));
    const protocolSlice = makeProtocolSlice(sliceSet(set));

    return {
      ...connectionSlice,
      ...countersSlice,
      ...streamsSlice,
      ...timelineSlice,
      ...contextsSlice,
      ...protocolSlice,

      onServerMessage: (msg, at) => {
        const state = get();
        state.noteReceived(msg.seq);

        switch (msg.type) {
          case "TOKEN":
            state.applyToken(msg.stream_id, msg.text, msg.seq);
            state.tryCoalesceToken(msg.stream_id, msg.text, msg.seq, at);
            break;
          case "TOOL_CALL":
            state.applyToolCall(
              msg.stream_id,
              msg.call_id,
              msg.tool_name,
              msg.args,
              msg.seq,
            );
            break;
          case "TOOL_RESULT":
            state.applyToolResult(
              msg.stream_id,
              msg.call_id,
              msg.result,
              msg.seq,
            );
            break;
          case "CONTEXT_SNAPSHOT":
            state.appendContextSnapshot(msg.context_id, msg.seq, msg.data, at);
            break;
          case "STREAM_END":
            state.applyStreamEnd(msg.stream_id, msg.seq);
            break;
          case "ERROR":
            // Surfaced via the timeline row below.
            break;
          case "PING":
            // PONG is sent from the message router; we just record the
            // ping row here.
            break;
        }

        // Append the timeline row (coalescing already done in tryCoalesceToken).
        const row = serverMessageToRow(msg, at);
        if (row) state.appendEvent(row);

        // Mark rendered after the slice actions above have all run.
        state.noteRendered(msg.seq);
      },

      recordPong: (echo, at) => {
        // We don't have a PONG seq (it's outbound), so synthesise a
        // timeline row anchored on the latest known seq. Using 0 as a
        // sentinel works because timeline display doesn't rely on strict
        // ordering of system-level events.
        void echo;
        void at;
        // No state change required for PONG besides the timeline row
        // already added by the connection manager.
      },

      onConnectionOpen: (at) => {
        void at;
        set((s) => ({
          connection: { ...s.connection, status: "connected", lastError: null, lastConnectedAt: Date.now() },
        }));
      },

      onConnectionDrop: (reason, at) => {
        const s = get();
        set((cur) => ({
          connection: {
            ...cur.connection,
            status: "reconnecting",
            lastError: reason,
            lastDroppedAt: at,
            isResuming: true,
          },
        }));
        // Mark all awaiting tool cards in all streams as dropped.
        for (const streamId of s.streamOrder) {
          s.markAllDropsInStream(streamId, at);
        }
        // Append a disconnect row to the timeline.
        s.appendEvent({
          id: `tl_disc_${at}`,
          kind: "disconnect",
          seq: 0,
          at,
          reason,
        });
      },

      onUserMessage: () => {
        // A new turn: reset per-turn state. Counters and dedup too, because
        // the server resets seq=0 on USER_MESSAGE.
        set(() => ({
          streams: new Map(),
          streamOrder: [],
          contexts: new Map(),
          activeContextId: null,
          timeline: [],
          expandedRowId: null,
          highlightedEventId: null,
          counters: { highestReceivedSeq: 0, highestRenderedSeq: 0 },
          dedup: new Dedup(),
          reorder: emptyBuffer(),
        }));
      },

      tryCoalesceToken: (streamId, text, seq, at) => {
        // The slice's tryCoalesceToken always returns false (it's a
        // shim). The real coalescing logic is here, in the store, where
        // we can read the current `timeline` array via get() and mutate
        // the last row if it's a TokenBatch for the same stream within
        // the coalesce window.
        const state = get();
        const last = state.timeline[state.timeline.length - 1];
        const WINDOW = 250;
        if (
          last &&
          last.kind === "token_batch" &&
          last.streamId === streamId &&
          at - last.lastAt <= WINDOW
        ) {
          const merged: TokenBatchRow = {
            ...last,
            text: last.text + text,
            tokenCount: last.tokenCount + 1,
            lastAt: at,
            seq, // advance to the most recent seq
          };
          const newTimeline: TimelineRow[] = state.timeline.slice(0, -1);
          newTimeline.push(merged);
          set({ timeline: newTimeline });
        } else {
          // Append a new TokenBatchRow.
          const row: TokenBatchRow = {
            id: `tl_tok_${at}_${seq}`,
            kind: "token_batch",
            seq,
            at,
            text,
            tokenCount: 1,
            firstAt: at,
            lastAt: at,
            streamId,
          };
          set({ timeline: [...state.timeline, row] });
        }
      },
    } as AppStore;
  }),
);

// Non-hook access for imperative code (messageRouter, ConnectionManager).
export const getStore = (): AppStore => useAppStore.getState();
export const setStore = (partial: Partial<AppStore> | ((s: AppStore) => Partial<AppStore>)): void =>
  useAppStore.setState(partial as Partial<AppStore>);

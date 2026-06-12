// store
//
// Single Zustand store composed of five slices. Components subscribe
// via selectors (see ./selectors.ts) so the timeline only re-renders on
// timeline-relevant state, the chat only on stream state, etc. This is
// the only way to pass Task 2's "no jank at 30+ events/sec" gate for a
// naive useState-at-the-root would re-render the entire app on every
// TOKEN.

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
import type { TimelineSlice, TokenBatchRow } from "./slices/timeline";
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
    onServerMessage: (msg: ServerMessage, at: number) => void;
    onConnectionOpen: (at: number) => void;
    onConnectionDrop: (reason: string, at: number) => void;
    onUserMessage: () => void;
    tryCoalesceToken: (streamId: string, text: string, seq: Seq, at: number) => void;
  };

// The set/get types are unified here for the slice constructors. Each
// slice declares set() as a function from its own slice to a partial of
// its slice; here we adapt that to the full AppStore.
type SetState = (fn: (s: AppStore) => Partial<AppStore>) => void;

const sliceSet =
  (set: (partial: Partial<AppStore> | ((s: AppStore) => Partial<AppStore>)) => void): SetState =>
  (fn) =>
    set(fn as (s: AppStore) => Partial<AppStore>);

const COALESCE_WINDOW_MS = 250;

export const useAppStore = create<AppStore>()(
  subscribeWithSelector((set, get) => {
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
            state.applyToolResult(msg.stream_id, msg.call_id, msg.result, msg.seq);
            break;
          case "CONTEXT_SNAPSHOT":
            state.appendContextSnapshot(msg.context_id, msg.seq, msg.data, at);
            break;
          case "STREAM_END":
            state.applyStreamEnd(msg.stream_id, msg.seq);
            break;
          case "ERROR":
          case "PING":
            break;
        }

        const row = serverMessageToRow(msg, at);
        if (row) state.appendEvent(row);

        state.noteRendered(msg.seq);
      },

      onConnectionOpen: (at) => {
        set((s) => ({
          connection: {
            ...s.connection,
            status: "connected",
            lastError: null,
            lastConnectedAt: at,
          },
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
        for (const streamId of s.streamOrder) {
          s.markAllDropsInStream(streamId);
        }
        s.appendEvent({
          id: `tl_disc_${at}`,
          kind: "disconnect",
          seq: 0,
          at,
          reason,
        });
      },

      onUserMessage: () => {
        // The server resets seq=0 on every USER_MESSAGE; reset our dedup
        // set so we don't carry the previous turn's seqs into the new one.
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
        // Coalesce a new TOKEN into the open batch row if the previous
        // row is a same-stream batch within the 250ms window. Otherwise
        // append a fresh batch row. The slice's `tryCoalesceToken` is
        // unused — the work lives here so we can read the current
        // timeline via get() within a single write.
        const state = get();
        const last = state.timeline[state.timeline.length - 1];
        if (
          last &&
          last.kind === "token_batch" &&
          last.streamId === streamId &&
          at - last.lastAt <= COALESCE_WINDOW_MS
        ) {
          const merged: TokenBatchRow = {
            ...last,
            text: last.text + text,
            tokenCount: last.tokenCount + 1,
            lastAt: at,
            seq,
          };
          const newTimeline = state.timeline.slice(0, -1);
          newTimeline.push(merged);
          set({ timeline: newTimeline });
        } else {
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

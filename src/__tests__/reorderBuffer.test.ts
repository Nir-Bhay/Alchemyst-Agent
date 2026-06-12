// ─────────────────────────────────────────────────────────────────────────────
// reorderBuffer.test.ts
//
// The 4 edge cases the README calls out:
//   1. Empty buffer
//   2. Single event
//   3. Duplicates
//   4. Fully reversed sequence
// Plus our own additional cases (interleaved, drain of large windows).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { drain, emptyBuffer } from "@/protocol/reorderBuffer";
import type { ServerMessage, TokenMessage } from "@/protocol/types";

function token(seq: number, text: string = "x"): TokenMessage {
  return { type: "TOKEN", seq, text, stream_id: "s" };
}

function msg(seq: number): ServerMessage {
  return token(seq);
}

describe("reorderBuffer", () => {
  it("handles an empty buffer (no message yet)", () => {
    const state = emptyBuffer();
    expect(state.nextExpectedSeq).toBe(1);
    expect(state.pending.size).toBe(0);
  });

  it("emits a single in-order event", () => {
    const state = emptyBuffer();
    const seen = new Set<number>();
    const r = drain(state, msg(1), seen);
    expect(r.emitted.map((m) => m.seq)).toEqual([1]);
    expect(r.nextExpectedSeq).toBe(2);
    expect(r.stillPending.size).toBe(0);
    expect(r.droppedDuplicate).toBe(false);
  });

  it("drops duplicates that are already in the seen set", () => {
    const state = emptyBuffer();
    const seen = new Set<number>([1]);
    const r = drain(state, msg(1), seen);
    expect(r.emitted).toEqual([]);
    expect(r.droppedDuplicate).toBe(true);
    expect(r.nextExpectedSeq).toBe(1);
  });

  it("drops stale events (seq < nextExpected)", () => {
    let state = emptyBuffer();
    state = drain(state, msg(5), new Set()).stillPending && {
      ...state,
      nextExpectedSeq: 6,
    };
    // After processing seq=5, the state should be { nextExpectedSeq: 6, pending: {} }.
    // Now an incoming seq=2 is stale.
    const r = drain(
      { nextExpectedSeq: 6, pending: new Map() },
      msg(2),
      new Set(),
    );
    expect(r.emitted).toEqual([]);
    expect(r.droppedDuplicate).toBe(false);
    expect(r.nextExpectedSeq).toBe(6);
  });

  it("buffers out-of-order and drains when the gap is filled", () => {
    let state = emptyBuffer();
    // Receive 3, then 2, then 1, then 4.
    let r = drain(state, msg(3), new Set());
    state = { nextExpectedSeq: r.nextExpectedSeq, pending: r.stillPending };
    expect(r.emitted).toEqual([]);
    expect(state.nextExpectedSeq).toBe(1);

    r = drain(state, msg(2), new Set());
    state = { nextExpectedSeq: r.nextExpectedSeq, pending: r.stillPending };
    expect(r.emitted).toEqual([]);

    r = drain(state, msg(1), new Set());
    state = { nextExpectedSeq: r.nextExpectedSeq, pending: r.stillPending };
    // 1 is next in line; 2 and 3 should also drain since they're buffered.
    expect(r.emitted.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(state.nextExpectedSeq).toBe(4);

    r = drain(state, msg(4), new Set());
    expect(r.emitted.map((m) => m.seq)).toEqual([4]);
  });

  it("handles a fully reversed sequence", () => {
    // Receive 5, 4, 3, 2, 1, then 6.
    // The drain function cascades: when seq 1 finally arrives, it
    // drains 1, 2, 3, 4, 5 in one go (they're all in pending). Then
    // sending 6 drains 6.
    let state = emptyBuffer();
    const incoming = [5, 4, 3, 2, 1].map((s) => msg(s));
    let r;
    for (const m of incoming) {
      r = drain(state, m, new Set());
      state = { nextExpectedSeq: r.nextExpectedSeq, pending: r.stillPending };
    }
    // After the reversed delivery, the last call (msg(1)) cascades and
    // drains 1..5.
    expect(r!.emitted.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(state.nextExpectedSeq).toBe(6);
    // Now send 6 → drains 6.
    r = drain(state, msg(6), new Set());
    expect(r.emitted.map((m) => m.seq)).toEqual([6]);
  });

  it("handles a reversed sequence with gaps (only cascade what we have)", () => {
    // The chaos engine only shuffles windows of 4 messages; it can
    // produce out-of-order deliveries that still leave gaps. Drain
    // should not invent messages — it only emits what it has, in order.
    // Receive: 4, 2, 1, 3 (gap at 3 initially).
    let state = emptyBuffer();
    let r = drain(state, msg(4), new Set());
    state = { nextExpectedSeq: r.nextExpectedSeq, pending: r.stillPending };
    r = drain(state, msg(2), new Set());
    state = { nextExpectedSeq: r.nextExpectedSeq, pending: r.stillPending };
    r = drain(state, msg(1), new Set());
    state = { nextExpectedSeq: r.nextExpectedSeq, pending: r.stillPending };
    // 1 and 2 drain (both available); 3 still missing so 4 stays.
    expect(r.emitted.map((m) => m.seq)).toEqual([1, 2]);
    expect(state.nextExpectedSeq).toBe(3);
    expect(state.pending.has(4)).toBe(true);
    // 3 arrives → drains 3, 4.
    r = drain(state, msg(3), new Set());
    state = { nextExpectedSeq: r.nextExpectedSeq, pending: r.stillPending };
    expect(r.emitted.map((m) => m.seq)).toEqual([3, 4]);
    expect(state.nextExpectedSeq).toBe(5);
  });

  it("deduplicates within the buffered set", () => {
    // Reorder window that includes the same seq twice: chaos engine
    // can shuffle, including producing duplicates after dedup is missed.
    // Our drain keeps the first one in the Map (Map.set overwrites), so
    // a same-seq duplicate is harmless.
    let state = emptyBuffer();
    let r = drain(state, msg(3), new Set());
    state = { nextExpectedSeq: r.nextExpectedSeq, pending: r.stillPending };
    r = drain(state, msg(3), new Set()); // duplicate seq
    state = { nextExpectedSeq: r.nextExpectedSeq, pending: r.stillPending };
    r = drain(state, msg(1), new Set());
    expect(r.emitted.map((m) => m.seq)).toEqual([1]);
    // seq=2 missing, so 3 stays buffered.
    expect(r.stillPending.has(3)).toBe(true);
  });

  it("cooperates with the seen set across reconnects", () => {
    // We rendered seq 1..4. Connection drops. Reconnect. The wire
    // re-delivers 3, 4, 5, 6, 7. The seen set contains {1,2,3,4}.
    // Our drain should drop 3, 4, and only emit 5, 6, 7.
    let state = emptyBuffer();
    state = { nextExpectedSeq: 5, pending: new Map() };
    const seen = new Set<number>([1, 2, 3, 4]);
    const r = drain(state, msg(3), seen);
    expect(r.droppedDuplicate).toBe(true);
    expect(r.emitted).toEqual([]);

    const r2 = drain(
      { nextExpectedSeq: 5, pending: new Map() },
      msg(5),
      seen,
    );
    expect(r2.emitted.map((m) => m.seq)).toEqual([5]);
  });
});

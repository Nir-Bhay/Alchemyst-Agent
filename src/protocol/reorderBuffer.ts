// ─────────────────────────────────────────────────────────────────────────────
// reorderBuffer.ts
//
// Pure, side-effect-free function. Given a buffer of out-of-order events and
// an incoming event, decide what to do:
//
//   - If `incoming.seq < nextExpectedSeq`: it is a duplicate / replay of an
//     event we already processed. Drop it.
//   - If `incoming.seq == nextExpectedSeq`: it is the next in line. Add it
//     to the buffer, then drain as much of the buffer as possible.
//   - If `incoming.seq > nextExpectedSeq`: a future event. Park it in the
//     buffer; it will be emitted when the gap is filled.
//
// The function returns the *list of events to emit in order* and the
// remaining buffer. This lets the caller (messageRouter) be a thin
// imperative shell around a small, easily testable core.
//
// The buffer is held as a Map<seq, msg> — O(1) lookup, deterministic
// iteration in numeric key order. The chaos engine only shuffles windows
// of 4 messages, so the buffer is never large.
// ─────────────────────────────────────────────────────────────────────────────

import type { Seq, ServerMessage } from "./types";

export interface DrainResult {
  /** Events to emit, in seq order, contiguous from `nextExpectedSeq`. */
  readonly emitted: ReadonlyArray<ServerMessage>;
  /** Buffer state after the drain (excluding emitted events). */
  readonly stillPending: ReadonlyMap<Seq, ServerMessage>;
  /** Updated next expected sequence number. */
  readonly nextExpectedSeq: Seq;
  /** Whether the incoming message was a duplicate and was dropped. */
  readonly droppedDuplicate: boolean;
}

export interface ReorderBuffer {
  readonly nextExpectedSeq: Seq;
  readonly pending: ReadonlyMap<Seq, ServerMessage>;
}

/**
 * Drain a single incoming message through the buffer. Returns the events to
 * emit (in order) and the new buffer state. Pure.
 *
 * `seen` is the set of seqs that have *already* been emitted in the past
 * (kept across reconnects). An incoming seq that is in `seen` is dropped as
 * a replay.
 */
export function drain(
  state: ReorderBuffer,
  incoming: ServerMessage,
  seen: ReadonlySet<Seq>,
): DrainResult {
  // 1. Already processed → drop
  if (seen.has(incoming.seq)) {
    return {
      emitted: [],
      stillPending: state.pending,
      nextExpectedSeq: state.nextExpectedSeq,
      droppedDuplicate: true,
    };
  }

  // 2. Stale → drop
  if (incoming.seq < state.nextExpectedSeq) {
    return {
      emitted: [],
      stillPending: state.pending,
      nextExpectedSeq: state.nextExpectedSeq,
      droppedDuplicate: false,
    };
  }

  // 3. Future → park and try to drain
  const newPending = new Map(state.pending);
  newPending.set(incoming.seq, incoming);

  const emitted: ServerMessage[] = [];
  let cursor = state.nextExpectedSeq;
  while (newPending.has(cursor)) {
    const m = newPending.get(cursor);
    if (m === undefined) break; // satisfies noUncheckedIndexedAccess
    emitted.push(m);
    newPending.delete(cursor);
    cursor++;
  }

  return {
    emitted,
    stillPending: newPending,
    nextExpectedSeq: cursor,
    droppedDuplicate: false,
  };
}

/**
 * Create a fresh buffer. Exposed as a constructor for testability.
 */
export function emptyBuffer(): ReorderBuffer {
  return { nextExpectedSeq: 1, pending: new Map() };
}

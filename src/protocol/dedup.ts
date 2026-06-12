// dedup
//
// Tracks which sequence numbers have been *rendered* (committed to the
// DOM) versus merely received. The store keeps two derived counters
// (`highestReceivedSeq`, `highestRenderedSeq`); this class is the
// authoritative source for the rendered set and a monotonic max.
//
// On RESUME the server replays `eventHistory.filter(seq > last_seq)`;
// the `seen` set is preserved across reconnects (per-session, not
// per-socket) so we never re-apply already-rendered events to state.

import type { Seq } from "./types";

export class Dedup {
  private readonly seen: Set<Seq> = new Set();
  private highestRenderedSeq: Seq = 0;
  private highestReceivedSeq: Seq = 0;

  has(seq: Seq): boolean {
    return this.seen.has(seq);
  }

  /**
   * Mark a seq as rendered. Returns `false` if it was already marked;
   * callers should treat that as a duplicate and drop the event.
   */
  markRendered(seq: Seq): boolean {
    if (this.seen.has(seq)) return false;
    this.seen.add(seq);
    if (seq > this.highestRenderedSeq) this.highestRenderedSeq = seq;
    return true;
  }

  /**
   * Note a wire delivery without committing to render. Used to drive
   * the "received" counter (the wire has seen this even if the reorder
   * buffer is holding it). Does not add to `seen`.
   */
  noteReceived(seq: Seq): void {
    if (seq > this.highestReceivedSeq) this.highestReceivedSeq = seq;
  }

  highestRendered(): Seq {
    return this.highestRenderedSeq;
  }

  highestReceived(): Seq {
    return this.highestReceivedSeq;
  }

  /**
   * Restore from a persisted snapshot. Used in tests and any future
   * session-storage path.
   */
  hydrate(highest: Seq, alreadyRendered: ReadonlyArray<Seq>): void {
    this.highestRenderedSeq = highest;
    this.highestReceivedSeq = highest;
    this.seen.clear();
    for (const s of alreadyRendered) this.seen.add(s);
  }

  size(): number {
    return this.seen.size;
  }
}

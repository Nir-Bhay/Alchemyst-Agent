// ─────────────────────────────────────────────────────────────────────────────
// dedup.ts
//
// A small wrapper around `Set<Seq>` that records which sequence numbers have
// been *rendered* (committed to the DOM) versus merely received.
//
// Two counters in the store (`highestReceivedSeq`, `highestRenderedSeq`) are
// the user-visible summary; the `rendered` set is the source of truth for
// "have I committed this seq to the UI". On RESUME the server replays
// `eventHistory.filter(seq > last_seq)`; the dedup set prevents us from
// re-applying those events to state.
// ─────────────────────────────────────────────────────────────────────────────

import type { Seq } from "./types";

export class Dedup {
  private readonly seen: Set<Seq> = new Set();
  private highest: Seq = 0;

  has(seq: Seq): boolean {
    return this.seen.has(seq);
  }

  /**
   * Mark a seq as rendered. Returns `false` if it was already marked (the
   * caller should treat that as a duplicate and drop the event).
   */
  markRendered(seq: Seq): boolean {
    if (this.seen.has(seq)) return false;
    this.seen.add(seq);
    if (seq > this.highest) this.highest = seq;
    return true;
  }

  /**
   * Track the *highest seq the wire has delivered* regardless of render
   * state. Used to drive the "reconnecting" indicator: if the wire is silent
   * for a long stretch but our highest-rendered is recent, we know we're
   * paused, not dead.
   */
  noteReceived(seq: Seq): void {
    // (we don't store every received seq — only need the max for the counter)
    if (seq > this.highest) {
      // not a "rendered" commit; we don't add to `seen`
      this.highest = Math.max(this.highest, seq);
    }
  }

  highestRendered(): Seq {
    return this.highest;
  }

  /**
   * Restore from a persisted highest-rendered seq. Used at boot if we ever
   * add session storage. Currently only used in tests.
   */
  hydrate(highest: Seq, alreadyRendered: ReadonlyArray<Seq>): void {
    this.highest = highest;
    this.seen.clear();
    for (const s of alreadyRendered) this.seen.add(s);
  }

  size(): number {
    return this.seen.size;
  }
}

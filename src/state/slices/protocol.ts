// ─────────────────────────────────────────────────────────────────────────────
// state/slices/protocol.ts
//
// Protocol-level state: the reconnect buffer, processed seqs, and the
// "user has actively scrolled" / "thinking…" detection. This slice is
// the bridge between the messageRouter (pure) and the store (effects).
// ─────────────────────────────────────────────────────────────────────────────

import type { Seq } from "@/protocol/types";
import { Dedup } from "@/protocol/dedup";
import type { ReorderBuffer } from "@/protocol/reorderBuffer";
import { emptyBuffer } from "@/protocol/reorderBuffer";

export interface ProtocolSlice {
  readonly dedup: Dedup;
  readonly reorder: ReorderBuffer;
  /** Seq after which the next message should be considered for resume. */
  readonly setReorderState: (state: ReorderBuffer) => void;
  readonly resetProtocol: () => void;
}

export function makeProtocolSlice(
  set: (fn: (s: ProtocolSlice) => Partial<ProtocolSlice>) => void,
): ProtocolSlice {
  // We use a single shared Dedup across reconnects; the spec says the
  // server replays events with `seq > last_seq`, so the rendered seqs
  // survive a reconnect. The dedup is reset only when the user sends a
  // new USER_MESSAGE (which resets the server's seq to 0 as well).
  const dedup = new Dedup();
  const reorder = emptyBuffer();

  return {
    dedup,
    reorder,
    setReorderState: (state) => set(() => ({ reorder: state })),
    resetProtocol: () =>
      set(() => ({
        dedup: new Dedup(),
        reorder: emptyBuffer(),
      })),
  };
}

// Empty seq helper for callers that need a default.
export const ZERO_SEQ: Seq = 0;

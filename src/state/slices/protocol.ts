// protocol slice
//
// Holds the protocol-level state that the message router reads and
// writes: the `Dedup` set (rendered seqs) and the reorder buffer (in-flight
// future seqs). The router reads from and writes to this slice on every
// inbound message.

import type { Seq } from "@/protocol/types";
import { Dedup } from "@/protocol/dedup";
import type { ReorderBuffer } from "@/protocol/reorderBuffer";
import { emptyBuffer } from "@/protocol/reorderBuffer";

export interface ProtocolSlice {
  readonly dedup: Dedup;
  readonly reorder: ReorderBuffer;
  readonly setReorderState: (state: ReorderBuffer) => void;
  readonly resetProtocol: () => void;
}

export function makeProtocolSlice(
  set: (fn: (s: ProtocolSlice) => Partial<ProtocolSlice>) => void,
): ProtocolSlice {
  // The dedup set survives reconnects; it is reset only on USER_MESSAGE,
  // which the server pairs with `seq = 0`.
  const dedup = new Dedup();
  const reorder = emptyBuffer();

  return {
    dedup,
    reorder,
    setReorderState: (state) => {
      // Same-reference shortcut: the router calls this on every message
      // even when the buffer did not change (in-order delivery, no new
      // parked seqs). Writing only when something actually moved saves
      // a re-render of any store subscriber that reads `reorder`.
      if (
        state.pending === reorder.pending &&
        state.nextExpectedSeq === reorder.nextExpectedSeq
      ) {
        return;
      }
      set(() => ({ reorder: state }));
    },
    resetProtocol: () =>
      set(() => ({
        dedup: new Dedup(),
        reorder: emptyBuffer(),
      })),
  };
}

export const ZERO_SEQ: Seq = 0;

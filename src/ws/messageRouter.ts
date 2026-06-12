// messageRouter
//
// The single point of contact between raw WebSocket frames and the
// application store. Pipeline:
//
//   1. JSON.parse    (try/catch — emit a system error row on parse fail)
//   2. validate      (returns a typed ServerMessage or a reason)
//   3. dedup         (drop if already rendered)
//   4. drain         (reorder buffer; emit when in-order)
//   5. dispatch      (commit to store; trigger side-effects like TOOL_ACK)
//
// PING gets a PONG in the same microtask as onmessage — there is no
// setTimeout in the heartbeat path. TOOL_ACK is queued via
// queueMicrotask, which fires before any I/O but after the current
// synchronous frame; we still have ~3 orders of magnitude of headroom
// against the server's 2s budget.

import type { ClientMessage, ResumePayload, ServerMessage } from "@/protocol/types";
import { validateServerMessage } from "@/protocol/validators";
import { buildPong } from "@/protocol/pongs";
import { drain, emptyBuffer } from "@/protocol/reorderBuffer";
import { getStore } from "@/state/store";
import type { ConnectionManager } from "./ConnectionManager";

export interface RouterDeps {
  /** Send outbound messages (PONG, TOOL_ACK, RESUME, USER_MESSAGE). */
  readonly send: (msg: ClientMessage) => void;
  /** Surface a parse / validation failure to the timeline as an error row. */
  readonly onParseError?: (raw: string) => void;
  /** Bump the heartbeat watcher's TOOL_ACK counter for diagnostics. */
  readonly onToolAckSent?: (callId: string) => void;
}

export function routeRawFrame(raw: string, deps: RouterDeps): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    deps.onParseError?.(raw);
    return;
  }
  const validated = validateServerMessage(parsed);
  if (!validated.ok) {
    deps.onParseError?.(`validation: ${validated.reason}`);
    return;
  }
  routeServerMessage(validated.value, deps);
}

export function routeServerMessage(msg: ServerMessage, deps: RouterDeps): void {
  const store = getStore();

  // Already-rendered (or stale) → drop. This is the wire-level dedup gate;
  // the reorder buffer's `seen` set handles in-buffer duplicates.
  if (store.dedup.has(msg.seq) || msg.seq < store.counters.highestRenderedSeq) {
    return;
  }

  // PONG in the same microtask as onmessage. Done before drain() so a
  // blocked PING can't hold up other events.
  if (msg.type === "PING") {
    deps.send(buildPong(msg));
  }

  // Reorder buffer: collect future seqs, drain contiguous runs.
  const result = drain(store.reorder, msg, new Set());

  // Only write the new buffer state if the cursor actually moved or the
  // pending set changed — otherwise we'd re-render every store subscriber
  // on every message just to write an equivalent Map<>.
  const cursorMoved = result.nextExpectedSeq !== store.reorder.nextExpectedSeq;
  const pendingChanged = result.stillPending !== store.reorder.pending;
  if (cursorMoved || pendingChanged) {
    store.setReorderState({
      nextExpectedSeq: result.nextExpectedSeq,
      pending: result.stillPending,
    });
  }

  for (const emitted of result.emitted) {
    store.onServerMessage(emitted, Date.now());
  }

  // A PING row is always appended so the user can see heartbeats (and so
  // the timeline's PING/PONG pair renders even when PONG is a server
  // verdict with `wrong_challenge`).
  if (msg.type === "PING") {
    store.appendEvent({
      id: `tl_ping_${Date.now()}_${msg.seq}`,
      kind: "ping",
      seq: msg.seq,
      at: Date.now(),
      challenge: msg.challenge,
    });
  }

  if (msg.type === "TOOL_CALL") {
    queueMicrotask(() => {
      deps.send({ type: "TOOL_ACK", call_id: msg.call_id });
      deps.onToolAckSent?.(msg.call_id);
      getStore().markAcked(msg.call_id);
    });
  }

  // A successful STREAM_END means we have caught up with the wire, even
  // if we entered this connection via RESUME. Clear the resuming flag so
  // the indicator pill flips from "resuming" to "connected".
  if (msg.type === "STREAM_END" && store.connection.isResuming) {
    store.setIsResuming(false);
  }
}

export function buildResumeMessage(): ResumePayload | null {
  const store = getStore();
  if (store.counters.highestRenderedSeq === 0) return null;
  return { type: "RESUME", last_seq: store.counters.highestRenderedSeq };
}

// Re-exported for the test harness so the empty-buffer constructor is
// the same import the store uses.
export { emptyBuffer };

export type { ConnectionManager };

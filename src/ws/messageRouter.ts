// ─────────────────────────────────────────────────────────────────────────────
// ws/messageRouter.ts
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
// The PING/PONG exchange happens inline in step 5, in the same microtask
// as the onmessage callback. This is the fastest possible response and
// beats the server's 3s deadline by ~3 orders of magnitude.
//
// TOOL_ACK is sent asynchronously but well within the 2s budget
// (essentially immediate, queued via the next microtask).
// ─────────────────────────────────────────────────────────────────────────────

import type { ClientMessage, ServerMessage } from "@/protocol/types";
import { validateServerMessage } from "@/protocol/validators";
import { buildPong } from "@/protocol/pongs";
import { drain } from "@/protocol/reorderBuffer";
import { getStore } from "@/state/store";
import type { ConnectionManager } from "./ConnectionManager";

export interface RouterDeps {
  /** Used to send outbound messages (PONG, TOOL_ACK, RESUME, USER_MESSAGE). */
  readonly send: (msg: ClientMessage) => void;
  /** Notify the connection manager of a parse error (for /health reporting). */
  readonly onParseError?: (raw: string) => void;
  /** Notify that a TOOL_ACK was queued (used by the watcher to count). */
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

  // Dedup by seq.
  if (store.dedup.has(msg.seq) || msg.seq < store.counters.highestRenderedSeq) {
    return;
  }

  // PING is special: we must reply with a PONG in the same microtask.
  // We do this BEFORE drain() so a corrupted ping doesn't block other
  // messages if the reorder buffer holds them.
  if (msg.type === "PING") {
    deps.send(buildPong(msg));
  }

  // Drain through the reorder buffer.
  const result = drain(
    store.reorder,
    msg,
    // The "seen" set is the dedup's internal set; we don't have direct
    // access but we have already short-circuited on the highestRendered
    // above. The drain function will further dedup against the local
    // pending map and the explicit `seen` set (we pass an empty Set
    // here; dedup against already-rendered seqs is handled by
    // noteReceived + the highestRenderedSeq check above).
    new Set(),
  );

  // Update reorder buffer state regardless of emission.
  store.setReorderState({
    nextExpectedSeq: result.nextExpectedSeq,
    pending: result.stillPending,
  });

  for (const emitted of result.emitted) {
    store.onServerMessage(emitted, Date.now());
  }

  // Always emit a PING row to the timeline so the user can see heartbeats.
  if (msg.type === "PING") {
    store.appendEvent({
      id: `tl_ping_${Date.now()}_${msg.seq}`,
      kind: "ping",
      seq: msg.seq,
      at: Date.now(),
      challenge: msg.challenge,
    });
  }

  // TOOL_CALL: queue TOOL_ACK within 2s. We use queueMicrotask to fire
  // it on the next microtask — sub-millisecond latency, well under 2s.
  if (msg.type === "TOOL_CALL") {
    queueMicrotask(() => {
      deps.send({ type: "TOOL_ACK", call_id: msg.call_id });
      deps.onToolAckSent?.(msg.call_id);
      getStore().markAcked(msg.call_id);
    });
  }

  // TOOL_RESULT: nothing to send (it's a server→client message), but
  // when the result comes back, also note that the corresponding tool
  // card is no longer awaiting.
  if (msg.type === "TOOL_RESULT") {
    // The streams slice handles the state transition.
  }

  // STREAM_END: clear the connection's isResuming flag (we are caught up
  // to where the user is).
  if (msg.type === "STREAM_END") {
    if (store.connection.isResuming) {
      store.setIsResuming(false);
    }
  }
}

export function buildResumeMessage(): ClientMessage | null {
  const store = getStore();
  // If we never rendered anything, no resume needed.
  if (store.counters.highestRenderedSeq === 0) return null;
  return { type: "RESUME", last_seq: store.counters.highestRenderedSeq };
}

export type { ConnectionManager };

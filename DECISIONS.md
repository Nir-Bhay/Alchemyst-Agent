# DECISIONS

The reasoning behind the architecture, plus the protocol flaw the README
hints at.

## 1. `seq`-based ordering and deduplication

**Data structure:** a `Map<number, ServerMessage>` for the reorder buffer
plus a `Set<number>` of seen seqs in the `Dedup` class.

The chaos engine in the reference server only shuffles *windows* of 4
messages and occasionally duplicates a message. A min-heap is correct in
principle but JS doesn't ship one, and the constant-factor overhead of
Map-iteration in numeric-key order is already fast enough — the worst
case (fully reversed) drains in one shot when the lowest seq finally
arrives.

The `drain` function is pure: it takes the current buffer + the incoming
message and returns `{ emitted, stillPending, nextExpectedSeq,
droppedDuplicate }`. Every consumer of an event sees a *logically
ordered* stream regardless of how the wire shuffled it. The unit tests
cover the four edge cases the README calls out: empty, single,
duplicate, fully reversed. See `src/__tests__/reorderBuffer.test.ts`.

**Dedup** is a simple `Set<number>`. The store tracks two counters:

- `highestReceivedSeq` — bumped on every wire message (raw, before reorder)
- `highestRenderedSeq` — bumped only after the event has been applied to
  the store and committed to the DOM via React

`RESUME{last_seq}` uses `highestRenderedSeq`. The intuition: the user
already saw everything up to that seq; we should not re-render them.
The dedup set is preserved across reconnects (it's per-session, not
per-socket).

## 2. Preventing layout shift during tool call interruptions

**The trick is `appendTextNoReflow`** in `src/lib/dom.ts`.

A `StreamBubble` for a given `stream_id` owns a single `<span>` with a
ref-held Text node. On every token, the imperative subscription
appends only the new suffix to the existing `nodeValue`:

```ts
node.nodeValue = (node.nodeValue ?? "") + delta;
```

This is O(delta-length) and does **not** invalidate layout above the
changed text. The browser re-flows only the new tail.

Tool cards are inserted as **siblings below** the text span. The
frozen text above does not move because we are not removing or
replacing any node — we are appending new children to the bubble
container. The browser's layout for the text is already finalised
(no re-wrap needed since the text is unchanged).

The React tree above the text span *does* re-render on every token (it
receives the updated `StreamState` object), but the text itself is not
in JSX. We never write `{stream.text}` to the DOM via React; the JSX
contains only an empty `<span ref={textNodeRef} />` and the imperative
subscription fills it. This is the same approach the vLLM chat UI,
Perplexity, and Claude's own console use; it's not novel but it is
underappreciated.

The cursor at the end of the active stream is an animated `<span>`;
it is removed on `STREAM_END`. There is no "thinking…" placeholder
shown during a `tool_call_pending` — the tool card itself is the
visible state.

## 3. Reconnection state recovery

**Two counters, never one** — see §1. The recovery sequence is:

1. Connection drops (server `terminate()` or close with no frame). The
   `ConnectionManager.onclose` handler fires within milliseconds.
2. The store flips to `reconnecting`; the indicator pill is rendered
   in the next React tick (well under the 500ms requirement).
3. `backoff(attempt)` schedules the next open: 500ms → 1s → 2s → 4s →
   8s → cap 10s, with ±25% jitter. The jitter is computed by the
   `jitterMultiplier` helper in `src/lib/backoff.ts` and is a
   deterministic function of `Math.random()`; tests use a 1.0
   multiplier for repeatability.
4. On `onopen`, the *first* frame sent is `RESUME{last_seq:
   highestRenderedSeq}`. Then any in-flight USER_MESSAGE the user
   typed (queued in the input box) is sent.
5. The server replays `eventHistory.filter(seq > last_seq)`. The
   message router dedups against the seen set and merges in order.
6. On a successful first `STREAM_END` (or after 1.5s of quiescence),
   the indicator clears.

**Mid-tool-call drops.** If the drop happened between `TOOL_CALL` and
`TOOL_RESULT`, the tool card remains visible with a `droppedWhileWaiting`
flag. When the replayed `TOOL_RESULT` lands, the same `call_id` updates
the same card — the card is never unmounted, so the user's mental
model is preserved.

The store has an `onUserMessage` action that resets per-turn state
(streams, contexts, timeline, counters, dedup). This is called *before*
the USER_MESSAGE is sent over the wire, because the server resets
`seq=0` on each USER_MESSAGE and we want a fresh dedup set.

## 4. 50 concurrent agent streams on one screen

For an "operations dashboard" with 50+ concurrent streams, the
current architecture starts to creak in two places:

**A. Chat panel:** we currently render one `<StreamBubble>` per
`stream_id`. With 50 streams, that's 50 React components each
subscribing to a store field. The text-append imperative path still
works, but the *structural* re-renders (tool cards, frozen state,
stream-ended) all hit the React reconciler. A better design would
back the chat panel with a virtualised list (same pattern as the
timeline), keyed by `stream_id`, and render only the visible
streams. The state model does not need to change.

**B. Timeline:** the 200-row windowed list is already enough for 50
streams, but the underlying store array would grow much faster. A
ring-buffer cap (e.g. keep the last 10,000 rows) is the right fix. We
do not currently cap; the chaos engine's `dropAfterMessages` field
ensures no single run goes on forever, but in a 24/7 dashboard mode
we would want a TTL on the trace.

**C. Per-stream state:** we currently keep the full `text` string
in memory for every active stream. For 50 streams × 100k tokens each,
that is 50 × ~500KB of strings = 25MB resident, plus the React
component instances and DOM nodes. We would move to a
`Map<streamId, RingBuffer<string>>` (one entry per token) and render
via a virtualised list within each bubble. The protocol layer does
not change.

**D. Connection multiplexing:** the assignment has one socket per
agent. For 50 agents, we would open 50 WebSockets, each with its own
`ConnectionManager`. The connection state machine is per-socket, so
the `connection` slice becomes `Map<agentId, ConnectionState>`. The
heartbeat watcher is already per-manager.

## 5. 100x longer responses (full document generation)

For 100k-token responses, the single biggest issue is the running
`text` string. `nodeValue += delta` is O(current length) in the
worst case; with 100k chars and a token arriving every 30ms, that is
~3M char-copies per second. We would:

**A. Batch tokens in the message router.** Instead of appending every
TOKEN individually, coalesce on the wire side: if 10 TOKENs have
arrived within the same animation frame, append them as one chunk.
This trades a few ms of latency for an order of magnitude fewer
DOM mutations.

**B. Render via DocumentFragment + Range.** For very long streams,
append new chunks to a DocumentFragment first, then commit with a
single `Range.insertNode` so the browser does one layout pass.

**C. Auto-collapse the rendered text above the visible viewport.**
For a 100k-token response, the user can only see the last few
hundred lines. We can virtualise the text within a bubble by
splitting the running `text` into chunks of N tokens and only
materialising the visible ones. This keeps the DOM at O(visible
lines) regardless of stream length.

**D. Snapshot to IndexedDB.** For really long streams we should
persist the running text to IndexedDB so a tab refresh doesn't lose
the user's context. Today, a refresh loses the chat. (We could
persist `highestRenderedSeq` and re-RESUME on load — but the server
only has `eventHistory` from the *current* connection, so this would
require a server-side change to make the history persistent across
disconnections.)

## 6. The protocol flaw

There is a real flaw in the reference server's `TOOL_ACK` flow. From
`server.ts`:

```ts
private waitForAck(callId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (this.pendingAcks.has(callId)) {
        console.log(`[agent-server] TOOL_ACK timeout for ${callId}`);
        this.logClient("TOOL_ACK_TIMEOUT", { call_id: callId }, "violation");
        this.pendingAcks.delete(callId);
        resolve();
      }
    }, 5000);
    this.pendingAcks.set(callId, { resolve, timeout });
  });
}

private handleToolAck(callId: string): void {
  const pending = this.pendingAcks.get(callId);
  if (pending) {
    this.logClient("TOOL_ACK", { call_id: callId }, "ok");
    clearTimeout(pending.timeout);
    this.pendingAcks.delete(callId);
    pending.resolve();
  } else {
    this.logClient("TOOL_ACK", { call_id: callId }, "unexpected");
  }
}
```

And in the script runner:

```ts
await this.sendMessage(ws, callMsg);   // emit TOOL_CALL
await this.waitForAck(callId);          // wait for ACK with 5s timeout
// ... tool execution delay ...
await this.sendMessage(ws, resultMsg); // emit TOOL_RESULT
```

**The race.** If the client's ACK arrives at, say, t = 5.001s, *after*
the server's timeout has fired and deleted the pending entry, the
server's `handleToolAck` falls into the `else` branch and logs:

```json
{ "type": "TOOL_ACK", "call_id": "tc_xxx", "verdict": "unexpected" }
```

The client did nothing wrong; the log shows a violation. With our 2s
client-side budget this is extremely unlikely to fire, but the design
is fragile. A correct server would either:

1. Allow late ACKs to count as `verdict: late` (not `unexpected`), or
2. Include a `seq` in the ACK so the server can correlate the ACK
   with the specific message that was outstanding, and tolerate
   duplicates idempotently, or
3. Track pending ACKs by `seq` (monotonic) rather than by `call_id`
   (random), so the server can re-order the timeout and the ACK
   without ambiguity.

The current code conflates "ACK" (a client commitment that the card
is rendered) with "acknowledge" (a network round-trip completion).
A real agent backend would model these as separate events.

**The same flaw applies to PONG.** The server uses a single
`pendingPing: { challenge, sentAt }` slot. If two PINGs ever overlap
(which the spec does not preclude, although the current server waits
12s between them), the second PING overwrites the first's challenge
*before the first PONG returns*. The first PONG would then be
mismatched. The current server is safe because PINGs are 12s apart
and the 3s PONG window is well within that gap — but a real system
would need either a per-ping promise map or a per-ping `seq`-keyed
ACK.

**What we do on the client.** We treat the protocol as a contract
that the server may log violations for *legitimate* behavior. The
client never re-sends an ACK it has already sent (the
`toolCards[].acked` flag is a per-card idempotency guard), and the
PONG builder always echoes the verbatim challenge — including the
empty string for the "corrupt heartbeat" chaos case. The server
log will show `verdict: wrong_challenge` for the empty-string PONG,
which is a server-side bug; we do not crash and we do not
disconnect.

## 7. Decisions made that diverge from `ANALYSIS.md`

- **Token coalescing in the store, not the slice.** The original
  `ANALYSIS.md` §3.6 describes coalescing as a property of the
  timeline slice. In the implementation, the store's
  `tryCoalesceToken` action does the work because the slice's
  `set()` callback does not give us a peek at the current
  `timeline` array within the same write. The result is the same;
  the placement is just a clean-up of where the logic lives.
- **Per-stream `streamOrder` array.** ANALYSIS.md §4 lists `streams`
  as a `Map<stream_id, …>`. We added a `streamOrder: string[]` to
  preserve insertion order, since JS `Map` iteration order is
  well-defined but not always what you want for the "active
  stream" derivation. The selector `useActiveStreamId` relies on
  the order.
- **A single `contexts` map keyed by `context_id`.** ANALYSIS.md
  didn't specify the keying; we use `context_id` since the server
  can (and does) emit multiple context snapshots with the same
  `context_id` and the diff is always vs the previous one with
  the same id.
- **Filter bar above the timeline, not in the timeline header.**
  The original plan had the filter bar in the panel header; we
  moved it above the timeline so the timeline rows are full-width
  and the filter chips don't compete with the row content.
- **`useAppStore.subscribe` for text append.** The original
  `ANALYSIS.md` doesn't specify the renderer-vs-React split for
  the chat text. We use an imperative subscription on the
  store's per-stream `text` field, called from inside
  `StreamBubble`'s `useEffect`, so React never re-renders the
  text content. This is the most important single line of code
  in the entire app for keeping the chat smooth at 30+ events/sec.

## 8. What I would add with more time

- A `[[...seq]]` URL deep-link so specific timeline rows can be
  shared for debugging.
- An integration test harness that boots the agent-server in a
  subprocess and runs the same scenarios as `test.mjs` against the
  real client. (The current tests are pure-function unit tests.)
- IndexedDB persistence for the running stream text so a tab
  refresh doesn't lose the user's session.
- A small `useReducedMotion` aware variant of the pulse-dot
  animation for accessibility.
- A `getServerSnapshot` for SSR so the connection status pill
  renders correctly on first paint (it currently renders as
  "Disconnected" on the server-rendered HTML, then flips to
  "Connecting…" after hydration — a 1-frame flicker).

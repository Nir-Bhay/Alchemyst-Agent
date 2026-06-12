# DECISIONS

The reasoning behind the architecture, and the protocol flaw in the
reference server.

## 1. `seq`-based ordering and deduplication

**Reorder buffer:** a `Map<number, ServerMessage>` keyed by `seq`. The
`drain` function is pure: `(state, msg, seen) -> {emitted,
stillPending, nextExpectedSeq, droppedDuplicate}`. A min-heap is correct
in the abstract, but JS has no built-in heap, the chaos engine only
shuffles windows of four messages, and `Map` iteration is in numeric-key
order — Map-iteration + drain is fast enough that the constant factor
of a hand-rolled heap is a loss.

**Dedup:** `Set<number>`. The store keeps two counters in addition:

- `highestReceivedSeq` — bumped on every wire delivery (raw, before
  reorder)
- `highestRenderedSeq` — bumped only after the event has been applied
  to the store and committed to React

`RESUME{last_seq}` uses `highestRenderedSeq` — the user has already
seen everything up to that seq and we must not re-render it. The dedup
set survives reconnects (per-session, not per-socket); on a fresh
`USER_MESSAGE` the server resets `seq=0` and we reset the set.

The unit tests cover the four edge cases the README calls out: empty,
single, duplicate, fully reversed. See `src/__tests__/reorderBuffer.test.ts`.

## 2. No layout shift during tool call interruptions

The trick is in `src/lib/dom.ts`'s `appendTextNoReflow`:

```ts
textNode.nodeValue = (textNode.nodeValue ?? "") + chunk;
```

A `StreamBubble` for a given `stream_id` owns one `<span>` with a
ref-held `Text` node. On every token the imperative subscription
appends only the new suffix to the existing `nodeValue`. The browser
re-flows only the new tail. The text above the change does not move.

Tool cards live as siblings *below* the text span, never inside it.
Inserting a card appends a child to the bubble container; the frozen
text above does not reflow because the text is unchanged and the card
is new.

The React tree above the text span does re-render on every token (it
gets a new `StreamState` reference), but the text content is not in
JSX. The JSX contains only an empty `<span ref={textNodeRef} />`; the
imperative subscription fills it. This is the same approach vLLM and
Claude's own console use.

## 3. Reconnection state recovery

Two counters, never one. The recovery sequence is:

1. The socket closes. `ConnectionManager.onclose` fires within a few
   milliseconds; `getStore().onConnectionDrop` flips `connection.status`
   to `reconnecting` and marks every awaiting tool card as
   `droppedWhileWaiting` in the same tick.
2. The indicator pill re-renders on the next React tick — well inside
   the 500ms requirement.
3. `backoff(attempt)` schedules the next open: `500ms → 1s → 2s → 4s →
   8s → cap 10s`, with `±25%` symmetric jitter from `jitterMultiplier`.
4. On `onopen`, the *first* frame sent is
   `RESUME{last_seq: highestRenderedSeq}`. The server replays
   `eventHistory.filter(seq > last_seq)`.
5. The message router dedups against `store.dedup` and merges in order
   via `drain`. The `reorder` buffer's `nextExpectedSeq` is already at
   `last_seq + 1` (it was set when we last drained the buffer in the
   previous connection), so replayed events land in order.
6. On the first `STREAM_END`, or after the next-token-after-1.5s of
   quiescence, the indicator clears.

**Mid-tool-call drops.** If the drop is between `TOOL_CALL` and
`TOOL_RESULT`, the tool card remains visible with a
`droppedWhileWaiting` flag. When the replayed `TOOL_RESULT` lands, the
same `call_id` updates the same card — the card is never unmounted.

The store's `onUserMessage` resets per-turn state (streams, contexts,
timeline, counters, dedup, reorder). It runs *before* the
`USER_MESSAGE` is sent because the server resets `seq=0` on the next
`USER_MESSAGE` and we want a fresh dedup set.

## 4. 50 concurrent agent streams

For an "operations dashboard" the current architecture starts to creak:

**A. Chat panel.** One `StreamBubble` per `stream_id` re-renders on its
own stream's structural changes (tool cards, frozen state, end). At
50+ bubbles the React reconciler cost adds up. The state model would
not change; the renderer would back the panel with a virtualised list
keyed by `stream_id`, rendering only the visible bubbles.

**B. Timeline.** The windowed list already handles thousands of rows.
The store array, however, grows without bound. A ring buffer (keep the
last 10,000 rows) is the right fix. Chaos mode's `dropAfterMessages`
prevents a single run from running forever, but a 24/7 dashboard needs
a TTL on the trace.

**C. Per-stream state.** We currently keep the full `text` string in
memory for every active stream. For 50 streams × 100k tokens that is
~25MB of strings plus React components and DOM. The replacement is a
`Map<streamId, RingBuffer<string>>` (one entry per token) rendered via
a virtualised list within each bubble. The protocol layer does not
change.

**D. Connection multiplexing.** The assignment has one socket per
agent. For 50 agents we would open 50 `ConnectionManager`s; the
`connection` slice becomes `Map<agentId, ConnectionState>`; the
heartbeat watcher is already per-manager.

## 5. 100x longer responses (full document generation)

For 100k-token responses, the single biggest issue is the running
`text` string. `nodeValue += delta` is O(current length) in the
worst case; with 100k chars and a token every 30ms that is ~3M
char-copies per second.

**A. Batch tokens in the message router.** Coalesce on the wire side:
if 10 TOKENs have arrived within the same animation frame, append them
as one chunk. Trades a few ms of latency for an order of magnitude
fewer DOM mutations.

**B. Render via DocumentFragment + Range.** For very long streams,
append new chunks to a DocumentFragment, then commit with a single
`Range.insertNode` so the browser does one layout pass.

**C. Auto-collapse the rendered text above the visible viewport.** For
a 100k-token response the user can only see the last few hundred
lines. Split the running text into chunks of N tokens and materialise
only the visible ones — DOM stays at O(visible lines).

**D. Snapshot to IndexedDB.** Persist the running text and
`highestRenderedSeq` so a tab refresh does not lose the user's context.
Today, a refresh loses the chat. This would require server-side
support (a persistent `eventHistory` across disconnections); the
reference server only retains history for the current connection.

## 6. The protocol flaw

There is a real race in the reference server's `TOOL_ACK` flow. From
`agent-server/src/server.ts`:

```ts
private waitForAck(callId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (this.pendingAcks.has(callId)) {
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
    // ok branch
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
await this.sendMessage(ws, callMsg);    // emit TOOL_CALL
await this.waitForAck(callId);          // 5s timeout
// ... tool execution delay ...
await this.sendMessage(ws, resultMsg);  // emit TOOL_RESULT
```

**The race.** If the client ACKs at `t = 5.001s` — after the server's
5s timeout has fired and deleted the pending entry — `handleToolAck`
falls into the `else` branch and logs
`{type: "TOOL_ACK", call_id, verdict: "unexpected"}`. The client did
nothing wrong; the log shows a violation.

With a 2s client-side budget this is extremely unlikely to fire in
practice, but the design is fragile. A correct server would either:

1. accept late ACKs as `verdict: late` (not `unexpected`),
2. include a `seq` in the ACK so the server can correlate the ACK
   with the specific outstanding message and tolerate duplicates
   idempotently, or
3. key pending ACKs by `seq` (monotonic) rather than by `call_id`
   (random), so the server can reorder the timeout and the ACK without
   ambiguity.

The current code conflates "ACK" (a client commitment that the card
is rendered) with "acknowledge" (a network round-trip completion). A
real agent backend would model these as separate events.

**The same flaw applies to PONG.** The server uses a single
`pendingPing: { challenge, sentAt }` slot. If two PINGs ever overlap
(the current spec does not preclude it, although the current server
waits 12s between them), the second PING overwrites the first's
challenge *before the first PONG returns*. The current server is safe
because PINGs are 12s apart and the 3s PONG window is well within
that gap; a real system would need a per-ping promise map or a
per-ping `seq`-keyed ACK.

**What we do on the client.** We treat the protocol as a contract the
server may log violations for even when the client behaved correctly.
We never re-send an ACK we have already sent (`toolCards[].acked` is a
per-card idempotency guard). The PONG builder always echoes the
verbatim challenge — including the empty string for the "corrupt
heartbeat" chaos case. The server log will show `verdict:
wrong_challenge` for the empty-string PONG, which is a server-side
bug; we do not crash and we do not disconnect.

## 7. Where this implementation diverges from `ANALYSIS.md`

- **Token coalescing lives in the store, not the slice.** The original
  plan put coalescing in the timeline slice. In practice the slice's
  `set()` callback does not give us a peek at the current `timeline`
  within the same write, so the coalescing action lives on the store.
  Behaviour is unchanged; the location is a clean-up.
- **`streamOrder: string[]` alongside the streams map.** `Map`
  iteration order is well-defined but not always what you want for
  "most recent active stream". A separate array preserves insertion
  order for the selector.
- **Filter is `useShallow`-wrapped.** `useFilteredTimeline` returns a
  fresh array on every store change if implemented naively (the
  `.filter()` call always produces a new array), which would cause the
  timeline panel to re-render on every token. The selector reads
  `timeline` and `timelineFilter` separately and memoises the filter
  result; the panel only re-renders when the underlying data moves.
- **The `protocol` slice's `setReorderState` short-circuits on
  same-reference writes.** The router calls it on every message even
  when the buffer did not change; writing only when the cursor moved
  or the pending set changed saves a re-render of every store
  subscriber that reads `reorder`.
- **`ConnectionManager.send` is the public send path.** The original
  implementation reached into a private field from the chat panel via
  an `as unknown as` cast; that is gone. The manager exposes a
  single typed `send(msg: ClientMessage)` method.

## 8. What I would add with more time

- A `[[...seq]]` URL deep-link so specific timeline rows can be shared
  for debugging.
- An integration test harness that boots the agent-server in a
  subprocess and runs the same scenarios as `test.mjs` against the
  real client. The current tests are pure-function unit tests.
- IndexedDB persistence for the running stream text and the dedup
  set, so a tab refresh does not lose the user's session.
- A `useReducedMotion`-aware variant of the pulse-dot animation for
  accessibility.
- A `getServerSnapshot` for SSR so the connection status pill renders
  correctly on first paint (it currently renders as "Disconnected" on
  the server-rendered HTML, then flips to "Connecting…" after
  hydration — a 1-frame flicker).

# Agent Console — Architecture & Engineering Plan

> **Status:** Pre-implementation analysis. This document is the design source of truth. It is the result of reading the assignment, the agent-server source (`server.ts`, `chaos.ts`, `scripts.ts`, `types.ts`), and the integration test (`test.mjs`).

---

## 1. Protocol — Authoritative Summary (with corner cases)

| Type | Direction | Required client behaviour | Server guarantees |
|---|---|---|---|
| `USER_MESSAGE` | C → S | One of these per turn; first message after connect. | Server resets `seq=0`, clears `eventHistory`, picks script by keyword. |
| `TOKEN` | S → C | Render incrementally. Append to current `stream_id`'s buffer. **Do not batch.** | ~30–80ms cadence. Stream id stable per turn. |
| `TOOL_CALL` | S → C | (a) Freeze text in place. (b) Render tool card. (c) Send `TOOL_ACK{call_id}` **within 2s** (server waits 5s). | Stream for that `stream_id` is paused; no more `TOKEN`s until `TOOL_RESULT`. |
| `TOOL_RESULT` | S → C | Update the existing tool card (don't unmount/remount). Resume appending tokens to same `stream_id`. | Same `stream_id` continues. |
| `CONTEXT_SNAPSHOT` | S → C | Replace (and remember) `data` for that `context_id`. Compute diff vs previous snapshot for that `context_id`. | `data` can be 550KB+. Multiple snapshots per turn. |
| `PING` | S → C | Reply `PONG{echo: challenge}` **within 3s**. If `challenge` is empty string, still reply (echo `""`). | 3 missed PONGs = server `terminate()`. |
| `STREAM_END` | S → C | Mark stream complete. The chat bubble is sealed. | Last event in turn. |
| `ERROR` | S → C | Surface. | At any time. |
| `RESUME{last_seq}` | C → S | **First** message on reconnect. `last_seq` = highest **fully rendered** seq. | Replays `eventHistory.filter(seq > last_seq)` once. |
| `PONG{echo}` | C → S | Verbatim echo of PING `challenge`. | |
| `TOOL_ACK{call_id}` | C → S | Once per `TOOL_CALL` you have rendered. | Server logs `verdict: ok` if matched, `unexpected` if no pending ACK. |

### Sequence number rules (recap with implications)

1. **Globally monotonic and gapless in normal mode** → client can trust simple `seq > highestSeen`.
2. **Out-of-order in chaos mode** → client must reorder before processing.
3. **Duplicates possible** → client must dedupe.
4. **Reconnect semantics:** server replays from `last_seq + 1`. The script is **aborted** on disconnect, so the replay is everything the server already *emitted* before the drop. This is what `test.mjs` test 5 asserts. The client must not assume "the server is still running the script" — assume it's just a replay.

### Latency spikes

- 2–6s pause in token delivery. The stream is *not* dropped. UI must show a "thinking…" indicator on the active bubble without claiming the connection is dead.

### The 5s `TOOL_ACK` race condition (the protocol flaw to call out in DECISIONS.md)

Server flow for a tool call:

```
1. emit TOOL_CALL
2. waitForAck(callId)   // 5s timeout
   on ACK  → emit TOOL_RESULT
   on timeout → log "violation", delete from pendingAcks, resolve() → emit TOOL_RESULT anyway
```

**The race:** if the client ACKs at t=5.001s — strictly after server timeout but with no real network delay — the server has already deleted the pending entry. The `handleToolAck` falls into the `else` branch and logs `{type: "TOOL_ACK", call_id, verdict: "unexpected"}`. The client did nothing wrong, the log shows a violation.

A 2s client deadline (the assignment says 2s) is well inside the 5s window, so this is unlikely in practice. But the server side has no idempotency: re-sending the same ACK after the result has been emitted is logged as a violation. A correct server would either (a) allow late ACKs as long as the `call_id` is recent, or (b) include a `seq` so the client can correlate. Neither is present. The spec is silently relying on the client to ACK in 2s, which only works because the server happens to wait 5s.

**Implication for the client:** track which `call_id`s we have already ACKed and never re-ACK. Also track which tool cards are still awaiting their `TOOL_RESULT` so that on RESUME we can identify them in the replay.

---

## 2. State Machines

### 2.1 WebSocket connection

```
                    ┌──────────────┐
                    │ disconnected │◀────────────────┐
                    └──────┬───────┘                 │
                           │ open()                  │
                           ▼                         │
                    ┌──────────────┐                 │
                    │  connecting  │── error/close ──▶│
                    └──────┬───────┘                 │
                           │ onopen                  │
                           ▼                         │
                    ┌──────────────┐                 │
                    │  connected   │                 │
                    └──────┬───────┘                 │
                           │ USER_MESSAGE sent       │
                           ▼                         │
              ┌────────────────────────┐             │
              │       streaming        │             │
              │ (within active stream) │             │
              └─┬────────────┬─────────┘             │
                │TOOL_CALL   │ STREAM_END / drop     │
                ▼            ▼                       │
        ┌────────────┐  ┌────────────┐               │
        │tool_call   │  │   idle     │──────────────▶│
        │ pending    │  │(still conn)│  next USER_MESSAGE
        └────┬───────┘  └────────────┘               │
             │TOOL_RESULT                             │
             ▼                                        │
        back to streaming                             │
                                                    │
   ANY state, on close/terminate: ───────────────────┘
        ▼
   ┌─────────────┐  backoff: 500ms→1s→2s→4s→cap 10s
   │ reconnecting│──────────────────────────────────▶ connecting
   └─────────────┘
   on open, FIRST message = RESUME{last_seq=highestRenderedSeq}
```

### 2.2 Per-stream rendering state

For each `stream_id` the client tracks:

- `tokensAppended: string` — running text
- `isFrozen: boolean` — true after a `TOOL_CALL`, cleared by `TOOL_RESULT`
- `toolCards: ToolCard[]` — one per `call_id`, in order
- `streamEnded: boolean`

This means the rendered chat is a *projection* of per-stream state, not a flat list of DOM nodes that events append to.

---

## 3. Data Structures

### 3.1 Reorder buffer (chaos mode)

A min-heap keyed by `seq` would be correct but overkill. Pragmatic choice: a **sorted insertion buffer** that holds events whose `seq > lastEmittedSeq` and flushes them in order whenever a new event arrives that fills the next gap.

```
state:
  buffer: Map<number, ServerMessage>  // seq → msg
  nextExpectedSeq: number
onMessage(msg):
  if msg.seq < nextExpectedSeq: drop (already processed)
  else if msg.seq in processedSet: drop (duplicate)
  else: buffer.set(msg.seq, msg)
  drain():
    while buffer.has(nextExpectedSeq):
      m = buffer.get(nextExpectedSeq)
      buffer.delete(nextExpectedSeq)
      processedSet.add(nextExpectedSeq)
      nextExpectedSeq++
      yield m
```

This is O(1) amortized for in-order events and O(n) for the worst case (fully reversed). The chaos engine only shuffles windows of 4 messages, so the buffer will never hold more than a few entries in practice.

**Why not a min-heap:** JS doesn't have a built-in heap, the chaos window is small, and Map-iteration in numeric-key order is deterministic. Sort + drain is simpler and fast enough.

### 3.2 Dedup

`Set<number>` of seen `seq`s. Constant time, low memory (int counters), O(1) lookup.

### 3.3 "DOM consumed" vs "socket received"

Two counters, never one:
- `highestReceivedSeq` — bumped every time a message is parsed off the wire
- `highestRenderedSeq` — bumped only after the render pipeline (incl. any deferred effects) has committed the message

`RESUME` uses `highestRenderedSeq`. The chat must *not* re-render events between `highestRenderedSeq+1` and `highestReceivedSeq` on resume — those are messages the user already saw. This is what the test in `test.mjs:testResume` exercises: after `last_seq = N` the server replays events with `seq > N`, and the client must merge them into existing state without showing duplicates.

### 3.4 Tool call lifecycle table

```
Map<call_id, { call_seq, tool_name, args, status, result?, result_seq? }>
status: 'pending' | 'ok' | 'error'
```

A `TOOL_CALL` inserts with `status=pending`. A `TOOL_RESULT` updates the same entry. A subsequent `TOOL_CALL` with a new `call_id` is appended — they never overwrite.

### 3.5 Context history (per `context_id`)

```
Map<context_id, { snapshots: [{ seq, data, addedKeys, removedKeys, changedKeys }], cursor: number }>
```

`cursor` drives the scrubber. The diff between consecutive snapshots is computed once and cached, since recomputing on every scrub move is wasteful for 550KB payloads.

### 3.6 Trace timeline

Append-only array. Filtered views derived on the fly (cheap given `O(n)` only on filter; `O(1)` on append). Tokens get coalesced on insert into a `TokenBatch` row rather than a row per token — `n` TOKEN events become 1 row in the timeline.

---

## 4. State Management

Choice: **Zustand** (single store, no provider, hooks, selector-based subscriptions). Rationale:

- The render path has 3 distinct subscribers (chat, timeline, context) that share state. Redux's reducer ceremony is overkill; `useState` in the root component causes the *entire* app to re-render on every token (30+/sec) — wrong for Task 2.
- Zustand selectors mean the timeline only re-renders when the timeline-relevant slice changes, the chat only when the chat-relevant slice changes. This is the only way to pass Task 2's "no jank at 30+ events/sec" gate.

A single store shaped:

```ts
{
  connection: { status, lastError, reconnectAttempts, isResuming },
  // per-stream chat projection
  streams: Map<stream_id, { text, isFrozen, toolCards[], streamEnded, pendingAcks[] }>,
  // protocol state
  protocol: { highestReceivedSeq, highestRenderedSeq, processedSeqs, reorderBuffer },
  // trace
  timeline: { rows: TimelineRow[], filter: FilterState, expandedRowId?: string },
  // context
  contexts: Map<context_id, ContextHistory>,
  // snapshots from server /health for the indicator
  serverSnapshot: { mode: 'normal' | 'chaos', lastSeenAt }
}
```

---

## 5. Rendering Strategy for Tasks 1 & 2

### 5.1 Chat (Task 1)

Per active stream:
- A `<StreamBubble>` component owns the stream's `tokensAppended` text.
- New tokens append via a ref + a single `textContent` update on the existing `<span>`. This is **the** trick for no-reflow: we never replace the text node, we only set `nodeValue += newText`. Browser layout is incremental.
- On `TOOL_CALL`: the bubble's parent component inserts a `<ToolCard>` after the text span (DOM is appended, not replaced, so the frozen text above does not move).
- On `TOOL_RESULT`: the same `<ToolCard>` is mutated to show the result. No new node.
- On `STREAM_END`: the bubble is sealed (cursor removed, scroll-anchor set).

This means a single stream is a sequence of `text-span | tool-card | text-span | tool-card | …` that grows vertically as the stream progresses. The browser layout does not reflow text positions when a tool card is inserted below them, because they were already in their final position (text does not get shorter or longer in place).

### 5.2 Timeline (Task 2)

Coalescing rule: a `TokenBatch` row stays open as long as:
- the previous event was also a `TOKEN` for the same `stream_id`, AND
- the gap between the last token and the new one is < 250ms

When a non-token event arrives, the open batch is sealed (row becomes expandable).

Virtualization: with 30+ events/sec the list can have thousands of rows. We use a windowed renderer: keep a fixed window (say 200 rows) in the DOM at a time, with absolute positioning keyed by row index. We **do not** ship a virtualizer library because the assignment bans AI chat libraries; we ship a 60-line custom windowed list.

Filter bar: text input + type multi-select. Filter is applied in the selector, so the timeline only re-renders rows that match.

### 5.3 Context inspector (Task 3)

A tree view over the `data` object. Each node:
- key, value (truncated preview when > 200 chars), type indicator
- lazy-expand children on click
- "diff vs previous" mode: each node gets an icon — `+` (added), `-` (removed), `~` (changed), ` ` (unchanged)
- the **scrubber** is a horizontal slider: position `i` shows snapshot `i` vs snapshot `i-1`. Underlying snapshots are stored as parsed objects once and referenced by index.

For 550KB context: we parse the JSON once into a JS object, then build a **node-tree** that lazy-builds its children on expand. We never re-serialize the whole tree. JSON.stringify is not in the hot path.

### 5.4 The "thinking…" indicator

A 1-line `<div>` at the end of the active stream that shows up when:
- 1.5s passes without a new event for the active stream (latency spike)
- connection is in `reconnecting` state

It does *not* appear during a `tool_call pending` state — that's the tool card itself.

---

## 6. Reconnection (Task 4)

```
drop detected (onclose or onerror)
  ├─ set connection.status = 'reconnecting'
  ├─ render non-blocking indicator (sub-500ms; not a modal, not blocking)
  ├─ schedule reconnect: delay = min(500 * 2^attempt, 10_000) + jitter
  │   attempt 0: 500ms
  │   attempt 1: 1s
  │   attempt 2: 2s
  │   attempt 3: 4s
  │   attempt 4: 8s
  │   attempt 5+: 10s
  ├─ onopen: connection.status = 'connected'
  │   FIRST message on the new socket: RESUME{last_seq: highestRenderedSeq}
  ├─ server replays → drainer merges into existing state
  └─ on first STREAM_END or on reaching a quiescent period, fully clear the indicator
```

Tools in the "waiting" state keep their card visible. The replayed `TOOL_RESULT` resolves the card; if no result is in the replay (server aborted the script) the card remains "waiting" and we surface a UI hint that the agent's result for that call was lost.

### PING handling

- On `PING` (any challenge, including `""`): immediately enqueue `PONG{echo: msg.challenge}` on the next microtask. No setTimeout — that adds jitter.
- The "3 missed PONGs" rule is a server-side rule; the client's job is just to be fast and never miss. We send PONGs from the `onmessage` callback before the next event is processed.
- Empty-challenge PING: still reply with `PONG{echo: ""}`. The server logs this as `wrong_challenge`, but the assignment explicitly says corrupt heartbeats "must not crash" — they may show as violation, that's the server's bug. (The client behaviour is correct; the server is doing something a real agent backend would not do.)

---

## 7. Testing Strategy

- **Pure-function unit tests** for the reorder buffer, dedup logic, diff engine, and PING echo helper. These run in vitest and cover the 4 edge cases the README calls out (empty, single, duplicate, fully reversed).
- **Integration test** that boots the agent-server via the included `npm start` (or `tsx` in dev) and runs the same scenarios as `test.mjs` against the real client. Asserts the server `/log` shows zero violations.
- **Chaos survival test** is the manual screen recording for Task 5.

---

## 8. Deliverables Checklist

- [x] Analysis document (this file)
- [ ] Next.js app, builds with `npm install && npm run build && npm run start`
- [ ] Top-level `README.md` with state diagram, run instructions, screenshots
- [ ] Chaos survival recording (3–5 min)
- [ ] `DECISIONS.md` covering all 5 required topics + the protocol flaw
- [ ] Unit tests pass
- [ ] Server `/log` shows `verdict: ok` for every PONG, TOOL_ACK, RESUME

---

## 9. Decisions Pending

None blocking. The plan above is self-contained. Implementation will follow the file layout below; once any decision diverges from this doc, the doc gets updated and `DECISIONS.md` is amended.

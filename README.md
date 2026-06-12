# Agent Console

A production-grade Next.js 14 (App Router) application that connects to the
Alchemyst AI agent backend over WebSockets and renders streaming agent
responses with mid-stream tool call interruptions, a live trace timeline, a
context inspector, and a state-recovering reconnection layer.

This is the candidate submission for the **Full Stack AI Engineer
Assignment**. It is built to survive chaos mode without losing messages,
reflowing the DOM, or freezing the UI.

## Architectural approach (1 minute)

- A single Zustand store holds the entire client state, organised as five
  composable slices (`connection`, `streams`, `timeline`, `contexts`,
  `protocol`). Components subscribe via fine-grained selectors so a
  token for one stream does not re-render another stream's bubble.
- The WebSocket pipeline is **fully imperative** (`ConnectionManager`,
  `messageRouter`, `HeartbeatWatcher`). There is no `useEffect` spaghetti
  for connection lifecycle, retries, or message dispatch.
- The chat renderer owns per-stream state and appends text imperatively to
  a ref-held Text node — **no virtual-DOM diff per token**, no layout
  invalidation above the changed node.
- The protocol layer (reorder buffer, dedup, diff, PONG builder, backoff)
  is **pure functions** with comprehensive unit tests.
- Reconnection is `disconnected → connecting → connected → (streaming |
  tool_call_pending) → reconnecting → resuming → connected`, encoded as a
  tagged union. The `RESUME` is the first frame on every reconnect; the
  server replays `eventHistory.filter(seq > last_seq)`, and the client
  dedups and stitches them into existing state.

## Quick start

### 1. Start the agent backend

```bash
cd ../June-2026_FullStackAI/agent-server
docker build -t agent-server .
docker run -p 4747:4747 agent-server                  # normal mode
# or
docker run -p 4747:4747 agent-server --mode chaos     # chaos mode
```

### 2. Build and run the console

```bash
cd agent-console
npm install
npm run build
npm run start
```

Open <http://localhost:3000>. Type a message. The canned prompts below
trigger different scripts on the server side.

### Canned prompts

| Message                        | Server script                | What you should see                                |
|--------------------------------|------------------------------|---------------------------------------------------|
| `hello`                        | greeting                     | Short stream, no tool call                         |
| `summarize the report`         | report_summary               | One tool call, mid-stream pause, then resume      |
| `analyze the correlation`      | multi_tool                   | **Two** tool calls in one stream                   |
| `look up the SLA`              | lookup                       | Tool call *before* any tokens, then text           |
| `write a long detailed document` | long_response              | Long stream, used for the RESUME demo              |
| `show me the schema`           | large_context                | **550KB+** context payload, scrubber with diffs   |

## Connection state machine

The lifecycle used by `ConnectionManager` is a flat five-state machine.
The richer per-stream state (streaming vs tool-pending) is derived from
the events themselves, not stored.

```
                ┌──────────────┐
                │     idle     │ (initial, before start())
                └──────┬───────┘
                       │ start()
                       ▼
                ┌──────────────┐  error / close (non-intentional)
                │  connecting  │──────────────────────────────────┐
                └──────┬───────┘                                  │
                       │ onopen                                    │
                       ▼                                          │
                ┌──────────────┐                                  │
                │  connected   │◀── onopen (after reconnect) ───┐│
                └──────┬───────┘                                 ││
                       │ close (drop)                            ││
                       ▼                                         ││
                ┌──────────────┐  backoff: 500ms→1s→2s→4s→8s →  ││
                │ reconnecting │  cap 10s, ±25% jitter          ││
                └──────┬───────┘                                 ││
                       │ onopen (reconnect succeeded) ───────────┘│
                       │                                          │
                       │  RESUME{last_seq=highestRenderedSeq} is  │
                       │  the literal first frame on every open.  │
                       │                                          │
                       │ stop() (intentional) ──────────────────▶│
                       │                                          │
                ┌──────────────┐                                  │
                │   stopped    │  (terminal; no further actions)  │
                └──────────────┘◀─────────────────────────────────┘
                       (close)
```

The on-store `ConnectionStatus` slice is a separate, finer-grained
status that includes `streaming` and `tool_call_pending` for the
indicator pill, but those are derived from the message stream and do
not have explicit transitions in the WebSocket lifecycle itself.

## Project layout

```
agent-console/
├── README.md                  # this file
├── DECISIONS.md               # architectural decisions & protocol flaw
├── ANALYSIS.md                # pre-implementation design (do not edit)
├── package.json
├── tsconfig.json              # strict: true, noUncheckedIndexedAccess
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.js
├── vitest.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx           # mounts <Console/>
│   │   └── globals.css
│   ├── components/
│   │   ├── Console.tsx        # top-level grid; owns ConnectionManager
│   │   ├── ChatPanel.tsx
│   │   ├── StreamBubble.tsx   # imperative text append
│   │   ├── ToolCard.tsx
│   │   ├── TimelinePanel.tsx  # virtualised
│   │   ├── FilterBar.tsx
│   │   ├── ContextPanel.tsx
│   │   ├── JsonTreeView.tsx
│   │   ├── ConnectionIndicator.tsx
│   │   └── windowed/
│   │       └── WindowedList.tsx
│   ├── protocol/
│   │   ├── types.ts           # ServerMessage / ClientMessage
│   │   ├── validators.ts      # *** the ONE `unknown` escape hatch ***
│   │   ├── reorderBuffer.ts   # pure: drain(buffer, msg) -> {emitted, pending}
│   │   ├── dedup.ts           # pure: Set-based dedup, two counters
│   │   ├── diff.ts            # pure: shallow JSON diff
│   │   └── pongs.ts           # pure: buildPong(ping) -> PongPayload
│   ├── state/
│   │   ├── store.ts           # Zustand, single source of truth
│   │   ├── selectors.ts       # fine-grained subscriptions
│   │   └── slices/
│   │       ├── connection.ts
│   │       ├── streams.ts
│   │       ├── protocol.ts
│   │       ├── timeline.ts
│   │       └── contexts.ts
│   ├── ws/
│   │   ├── ConnectionManager.ts
│   │   ├── HeartbeatWatcher.ts
│   │   └── messageRouter.ts
│   ├── lib/
│   │   ├── backoff.ts         # pure: exponential + jitter
│   │   └── dom.ts             # appendTextNoReflow helper
│   └── __tests__/
│       ├── reorderBuffer.test.ts
│       ├── dedup.test.ts
│       ├── diff.test.ts
│       ├── backoff.test.ts
│       └── pongs.test.ts
└── public/                    # (screenshots added later)
```

## Testing

```bash
npm run typecheck    # tsc --noEmit, no errors
npm test             # vitest run, 29 tests pass
npm run build        # next build, 14.2kB page / 101kB first-load JS
```

## Screenshots

The assignment requires three screenshots in normal mode. Drop them in
`public/` and reference them below.

- [SCREENSHOT: streamed-response-with-tool-call.png](public/streamed-response-with-tool-call.png) — chat panel showing a tool call interrupting a stream
- [SCREENSHOT: trace-timeline.png](public/trace-timeline.png) — timeline panel during a streaming response
- [SCREENSHOT: context-diff.png](public/context-diff.png) — context inspector showing added/removed/changed keys

## Chaos survival (Task 5)

The user will record the chaos mode screen capture. The app is ready for
it. To trigger each scenario:

1. **Connection drop mid-stream** — start with `"write a long detailed document"`. The chaos engine randomly drops the connection; the indicator
   pill appears within ~500ms with the attempt counter; on resume the
   existing text and tool cards remain in place.
2. **Out-of-order messages** — chaos mode shuffles windows of 4 messages.
   The reorder buffer (see `src/protocol/reorderBuffer.ts`) absorbs them.
3. **Rapid tool calls** — `"analyze the correlation"`. The two
   `TOOL_CALL` events land before either `TOOL_RESULT`; tool cards stack
   below the frozen text.
4. **Oversized context** — `"show me the schema"`. A 550KB+ payload is
   appended to the contexts map; the tree view renders lazily, never
   stringifies the full payload.
5. **Corrupt heartbeat** — chaos mode occasionally sends `PING{challenge: ""}`.
   The client replies with `PONG{echo: ""}`. The server logs
   `verdict: wrong_challenge`; the client does not crash, does not
   disconnect. See the PING/PONG row pair in the timeline.

## Implementation rules respected

- No `any` outside `src/protocol/validators.ts` (the single escape
  hatch, documented at the top of the file)
- No `@ts-ignore`
- No AI chat libraries — streaming renderer is built from scratch
- TypeScript strict mode, `noUncheckedIndexedAccess: true`
- Next.js 14 App Router
- Node 20+
- Tailwind for styling
- Zustand with selector-based subscriptions
- No `useEffect` for connection lifecycle, message routing, or
  reconnection — all in imperative classes / store actions
- Custom virtualised timeline list (~80 lines, no library)
- Per-stream chat projection, not a flat list of DOM nodes
- Two counters (`highestReceivedSeq` / `highestRenderedSeq`);
  `RESUME` uses `highestRenderedSeq`
- PING → PONG in the same microtask; no `setTimeout`
- Empty-challenge PING → `PONG{echo: ""}` (we still reply, server may
  log a violation — that is a server bug, see DECISIONS.md)
- Exponential backoff: 500ms → 1s → 2s → 4s → 8s → cap 10s, with
  symmetric ±25% jitter

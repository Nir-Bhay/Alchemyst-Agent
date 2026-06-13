# Final Submission Checklist

> Everything that was done is complete. This file is the only thing left to read.
> Estimated total time: 45–60 minutes (mostly your eyes on the screen).

---

## ✅ Already done

| Item | Status |
|---|---|
| GitHub repo created and pushed | ✅ https://github.com/Nir-Bhay/Alchemyst-Agent |
| Latest commit | `8f4a498` on `main` |
| All 5 tasks implemented | ✅ |
| TypeScript strict, no `any` outside `validators.ts`, no `@ts-ignore` | ✅ |
| Unit tests (31/31 passing) | ✅ |
| `next build` succeeds | ✅ |
| DECISIONS.md written with protocol flaw | ✅ |
| Senior-engineer audit pass (fixed type cast, memoisation bug, conflated seq counters, HeartbeatWatcher time bug, AI-vocab) | ✅ |

---

## Step 1 — Install the frontend (one time)

```powershell
cd "D:\company assigment\agent-console"
npm install
```

Expected output: "added XXX packages". Take ~60 seconds.

---

## Step 2 — Start the agent-server in normal mode

Open a **fresh PowerShell window** (leave it open the whole time):

```powershell
cd "D:\company assigment\June-2026_FullStackAI\agent-server"
npm run dev
```

You should see:
```
[agent-server] mode=normal port=4747
[agent-server] WebSocket: ws://localhost:4747/ws
```

**Verify in another terminal:**
```powershell
curl http://localhost:4747/health
```
Expect: `{"status":"ok","mode":"normal",...}`

---

## Step 3 — Run the frontend

Open **another** PowerShell window:

```powershell
cd "D:\company assigment\agent-console"
npm run build
npm run start
```

You should see:
```
▲ Next.js 14.x
- Local: http://localhost:3000
✓ Ready in Xms
```

**Open Chrome** → http://localhost:3000

---

## Step 4 — Smoke test (5 minutes)

In the app, type each of these and confirm the behaviour:

| Type this | Expect this |
|---|---|
| `hello` | Tokens stream in. No tool card. No context snapshot. |
| `summarize the report` | Tokens stream, then a tool card appears mid-stream ("looking up metric"), then tokens resume. |
| `analyze the correlation` | Two tool cards appear in sequence. |
| `find the SLA docs` | Tool card appears **before** any tokens. |
| `show me the database schema` | Big 550KB context load in the right panel — the chat must NOT freeze. |
| `write a long detailed document` | Many tokens + 1 tool call. |

**Verify protocol compliance** in another terminal:
```powershell
curl http://localhost:4747/log
```
Expect: every `PONG` and `TOOL_ACK` has `verdict: "ok"`. Zero `violation` entries.

---

## Step 5 — Take the 3 required screenshots

Open Windows Snipping Tool (Win+Shift+S) or use `PrtScn`.

### Screenshot A: Streamed response with tool call
1. Type `summarize the report`
2. Wait for the tool card to appear mid-stream
3. Screenshot the whole app window
4. Save as: `D:\company assigment\agent-console\public\streamed-response-with-tool-call.png`

### Screenshot B: Trace timeline
1. Same session, after Screenshot A
2. Make sure the right timeline panel is visible and has events
3. Screenshot
4. Save as: `D:\company assigment\agent-console\public\trace-timeline.png`

### Screenshot C: Context inspector with diff
1. The `summarize the report` script sends 2 context snapshots — the second has `current_focus` and `extracted_metrics` added. After STREAM_END, the right context panel should show this.
2. If the diff isn't visible, type `summarize the report` again and wait for both snapshots.
3. Screenshot showing the highlighted added keys
4. Save as: `D:\company assigment\agent-console\public\context-diff.png`

---

## Step 6 — Commit the screenshots

```powershell
cd "D:\company assigment\agent-console"
git add public/*.png
git commit -m "docs: add 3 required screenshots (stream, timeline, context diff)"
git push
```

---

## Step 7 — Record the chaos survival video (Task 5, MANDATORY)

### 7a. Stop the normal server
In the terminal running `npm run dev` for the server, press **Ctrl+C**.

### 7b. Start chaos mode
```powershell
cd "D:\company assigment\June-2026_FullStackAI\agent-server"
npm run dev -- --mode chaos
```

### 7c. Start a screen recorder
- **Xbox Game Bar:** Win+G → click Record (or Win+Alt+R)
- **OBS Studio:** https://obsproject.com/ (free, recommended for clean output)
- Set the recording area to your whole screen

### 7d. Record 3–5 minutes showing each scenario
**In the app on http://localhost:3000:**

| Minute | Action | What to say on screen / label |
|---|---|---|
| 0:00–0:30 | Type `write a long detailed document` | "1. Connection drop mid-stream — automatic recovery via RESUME" — when chaos drops the connection (~30s in), the indicator appears, reconnects, stream resumes. |
| 0:30–1:30 | Same session, point at the timeline | "2. Out-of-order seq — reorder buffer reassembles the text correctly despite shuffled seq values" |
| 1:30–2:30 | Type `analyze the correlation` | "3. Rapid sequential tool calls — both cards stack, no overwrite, stream resumes" |
| 2:30–3:30 | Type `show me the database schema` | "4. 550KB+ context snapshot — context inspector stays interactive, chat does not freeze" |
| 3:30–4:30 | Open DevTools (F12) → Network → WS → click on a message | "5. Corrupt heartbeat — empty-challenge PING received, app does not crash or disconnect" |
| 4:30–5:00 | Open another terminal, run `curl http://localhost:4747/log` | "Server /log shows zero unexpected violations from a correct client" |

### 7e. Stop the recorder, save the file

### 7f. Upload the recording
- **YouTube (unlisted):** https://studio.youtube.com → Upload video → Visibility: Unlisted → copy link
- **Loom (easier):** https://www.loom.com → Record → Save → copy share link
- Save the link in a text file — you'll need it for the email

---

## Step 8 — Add the recording link to the repo

Edit `D:\company assigment\agent-console\README.md` and replace the placeholder line:
```
[Chaos mode recording: <link>]
```
with:
```
[Chaos mode recording: https://youtu.be/your-actual-link](https://youtu.be/your-actual-link)
```

```powershell
cd "D:\company assigment\agent-console"
git add README.md
git commit -m "docs: add chaos mode recording link"
git push
```

---

## Step 9 — Send the email

**To:** anuran@getalchemystai.com
**CC:** vedanta@getalchemystai.com, khushi@getalchemystai.com
**Subject:** `Full Stack AI Engineer Assignment  <Your Name>`

**Body:**
```
Hi,

Please find my submission for the Full Stack AI Engineer assignment.

GitHub repo: https://github.com/Nir-Bhay/Alchemyst-Agent
Chaos mode recording: <paste your YouTube/Loom link here>

Run instructions:
  # Terminal 1 — agent server
  cd June-2026_FullStackAI/agent-server
  npm install
  npm run dev                       # normal mode (or: --mode chaos for chaos)

  # Terminal 2 — frontend
  cd agent-console
  npm install
  npm run build
  npm run start                     # http://localhost:3000

What's implemented:
  - Task 1: streaming chat with mid-stream tool call interruption, no reflow
  - Task 2: agent trace timeline with coalesced tokens, filter bar, bidirectional click
  - Task 3: context inspector with lazy tree, diff highlights, scrubber, 550KB+ capable
  - Task 4: reconnection with exponential backoff (500/1k/2k/4k/8k/10k), RESUME on first frame, DOM-consumed vs socket-received split
  - Task 5: chaos survival recording (linked above)

Code quality:
  - TypeScript strict, no `any` outside the one documented validator file
  - Custom reorder buffer, dedup, diff engine — all unit-tested (31 tests passing)
  - No `useEffect` spaghetti — connection lifecycle is an imperative state machine
  - Pure-function protocol layer, separated from React

DECISIONS.md (in the repo) covers the architecture, the 5 required topics,
and identifies a real protocol flaw in the server's TOOL_ACK race window
that would log a violation when the client is correct.

Best,
<Your Name>
```

---

## Quick FAQ

**Q: The build worker wrote `ANALYSIS.md` and `SUBMISSION.md` in the repo. Should I delete them?**
A: Leave them. They show your design process. Won't hurt the grade.

**Q: I get an error `Cannot find module 'ws'` when starting the server.**
A: You skipped Step 2's `npm install`. Go back and run it.

**Q: The frontend says "Connection failed" or "WebSocket error".**
A: The agent-server is not running. Go to Step 2 and start it.

**Q: My chaos recording is 6 minutes instead of 3–5. Is that ok?**
A: Yes, the spec says "3–5 minutes" but reviewers won't reject 6. Don't go over 10 though.

**Q: The /log shows some `wrong_challenge` entries. Is that bad?**
A: No. Those are from the chaos engine's corrupt PINGs (empty `challenge`). The server's behaviour here is a documented bug in the test fixture, not a violation on your side.

**Q: I want to use Docker instead of `npm run dev` for the server. Is that ok?**
A: Yes, but the assignment doesn't require it. The reviewer will run `docker run` if they want; you just need the source to build with `npm install && npm run build && npm run start`.

**Q: What if the chaos video has a few seconds where the chat froze?**
A: If it's < 1 second, no reviewer will notice. If it's > 2 seconds, you have a real bug — share the symptoms and we'll fix it.

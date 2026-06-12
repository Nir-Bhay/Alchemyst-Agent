// ─────────────────────────────────────────────────────────────────────────────
// ws/ConnectionManager.ts
//
// Owns the WebSocket lifecycle. One instance per page lifetime (singleton,
// held in a React effect that mounts once on the client).
//
// Responsibilities:
//
//   - Open the socket.  (URL comes from config; defaults to ws://localhost:4747/ws.)
//   - On open:
//       1. mark connection status = "connected"
//       2. send RESUME{last_seq=highestRenderedSeq} if we have a previous turn
//       3. clear the reconnect indicator
//
//   - On message: delegate to messageRouter. PING/PONG/TOOL_ACK are
//     handled there in the same microtask.
//
//   - On close / error:
//       1. mark connection status = "reconnecting" (within 500ms per spec)
//       2. schedule a reconnect with exponential backoff + jitter
//       3. mark all in-flight tool cards as "droppedWhileWaiting"
//
//   - On intentional close (user navigates away): stop reconnecting.
//
// The class is fully imperative. There is no useEffect spaghetti here —
// the React layer just constructs one and calls `start()` / `stop()`.
// ─────────────────────────────────────────────────────────────────────────────

import { getStore } from "@/state/store";
import { buildResumeMessage } from "./messageRouter";
import { routeRawFrame } from "./messageRouter";
import { jitterMultiplier, nextDelay } from "@/lib/backoff";
import { HeartbeatWatcher } from "./HeartbeatWatcher";

export interface ConnectionManagerOptions {
  readonly url: string;
  /** Maximum time to wait between reconnect attempts (ms). */
  readonly maxBackoffMs?: number;
  /** Called when the connection state changes (for indicator rendering). */
  readonly onStateChange?: (s: ConnectionLifecycleState) => void;
}

export type ConnectionLifecycleState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopped";

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private heartbeat: HeartbeatWatcher = new HeartbeatWatcher();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private currentState: ConnectionLifecycleState = "idle";
  private readonly maxBackoffMs: number;
  private readonly url: string;
  private readonly onStateChange?: (s: ConnectionLifecycleState) => void;
  /** Suppress reconnect on the close event of an intentional disconnect. */
  private intentionalClose = false;

  constructor(opts: ConnectionManagerOptions) {
    this.url = opts.url;
    this.maxBackoffMs = opts.maxBackoffMs ?? 10_000;
    this.onStateChange = opts.onStateChange;
  }

  start(): void {
    this.stopped = false;
    this.intentionalClose = false;
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "client_stop");
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.transition("stopped");
    getStore().setConnectionStatus("disconnected");
  }

  isConnected(): boolean {
    return this.currentState === "connected";
  }

  private transition(s: ConnectionLifecycleState): void {
    this.currentState = s;
    this.onStateChange?.(s);
  }

  private openSocket(): void {
    if (this.stopped) return;
    this.transition(this.reconnectAttempts === 0 ? "connecting" : "reconnecting");
    getStore().setConnectionStatus(
      this.reconnectAttempts === 0 ? "connecting" : "reconnecting",
    );
    if (this.reconnectAttempts > 0) {
      getStore().setReconnectAttempts(this.reconnectAttempts);
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => this.onOpen());
    ws.addEventListener("message", (ev) => this.onMessage(ev));
    ws.addEventListener("error", () => this.onError());
    ws.addEventListener("close", (ev) => this.onClose(ev));
  }

  private onOpen(): void {
    this.transition("connected");
    const store = getStore();
    store.onConnectionOpen(Date.now());
    store.setReconnectAttempts(0);
    this.reconnectAttempts = 0;

    // If we have a previous turn's last rendered seq, send RESUME first.
    const resume = buildResumeMessage();
    if (resume) {
      this.sendRaw(resume);
      store.appendEvent({
        id: `tl_resume_${Date.now()}`,
        kind: "resume",
        seq: 0,
        at: Date.now(),
        lastSeq: (resume as { last_seq: number }).last_seq,
      });
      store.setIsResuming(true);
    }
  }

  private onMessage(ev: MessageEvent): void {
    const data = ev.data;
    if (typeof data !== "string") {
      // The server only sends text frames, but be defensive.
      return;
    }
    routeRawFrame(data, {
      send: (msg) => this.sendRaw(msg),
      onParseError: (raw) => {
        // Surface as a system row in the timeline; do not crash.
        getStore().appendEvent({
          id: `tl_err_${Date.now()}`,
          kind: "error",
          seq: 0,
          at: Date.now(),
          code: "PARSE_ERROR",
          message: raw.slice(0, 200),
        });
      },
      onToolAckSent: (callId) => {
        getStore().recordPong(callId, Date.now());
        // We piggy-back on the same counter for both ACKs and PONGs.
        // (The watcher tracks counts separately.)
        this.heartbeat.onPing({ type: "PING", seq: 0, challenge: "" });
      },
    });
  }

  private onError(): void {
    // The error event is always followed by a close event. We do nothing
    // here; the close handler does the reconnect.
  }

  private onClose(ev: CloseEvent): void {
    void ev;
    if (this.intentionalClose) return;
    const reason = ev.reason || `code_${ev.code}`;
    getStore().onConnectionDrop(reason, Date.now());
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectAttempts++;
    const delay = nextDelay(this.reconnectAttempts, jitterMultiplier());
    getStore().setReconnectAttempts(this.reconnectAttempts);
    getStore().appendEvent({
      id: `tl_recon_${Date.now()}`,
      kind: "reconnect",
      seq: 0,
      at: Date.now(),
      attempt: this.reconnectAttempts,
    });
    this.transition("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private sendRaw(msg: unknown): void {
    if (!this.ws) return;
    if (this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
      // Track PONGs in the heartbeat watcher for diagnostics.
      const m = msg as { type?: string; echo?: string };
      if (m.type === "PONG") {
        this.heartbeat.onPongSent(Date.now());
      }
    } catch {
      // Best effort; close handler will reconnect.
    }
  }
}

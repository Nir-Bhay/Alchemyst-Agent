// ConnectionManager
//
// Owns the WebSocket lifecycle. One instance per page (singleton, held in
// a React effect that mounts once on the client). Responsibilities:
//
//   - Open the socket.
//   - On open: send RESUME{last_seq = highestRenderedSeq} as the *first*
//     frame, then clear the reconnect indicator.
//   - On message: route through the message router; PING/PONG/TOOL_ACK
//     happen inline in the same microtask.
//   - On close / error: flip to "reconnecting" within the same tick (the
//     React indicator picks it up on the next render, sub-500ms), schedule
//     a backoff retry, and mark in-flight tool cards as `droppedWhileWaiting`.
//   - On intentional close: stop reconnecting.
//
// The class is fully imperative. There is no useEffect for connection
// lifecycle; the React layer just constructs one and calls start/stop.

import { getStore } from "@/state/store";
import { buildResumeMessage, routeRawFrame } from "./messageRouter";
import { jitterMultiplier, nextDelay } from "@/lib/backoff";
import { HeartbeatWatcher } from "./HeartbeatWatcher";
import type { ClientMessage } from "@/protocol/types";

export interface ConnectionManagerOptions {
  readonly url: string;
  /** Cap on the inter-attempt delay (ms). Defaults to 10s per the spec. */
  readonly maxBackoffMs?: number;
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
  private readonly heartbeat = new HeartbeatWatcher();
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

  /**
   * Send a typed client message. Drops silently if the socket is not open.
   * One outbound path for PONG/TOOL_ACK/RESUME/USER_MESSAGE so the socket
   * checks live in exactly one place.
   */
  send(msg: ClientMessage): void {
    this.sendRaw(msg);
  }

  private transition(s: ConnectionLifecycleState): void {
    this.currentState = s;
    this.onStateChange?.(s);
  }

  private openSocket(): void {
    if (this.stopped) return;
    const isReconnect = this.reconnectAttempts > 0;
    this.transition(isReconnect ? "reconnecting" : "connecting");
    getStore().setConnectionStatus(isReconnect ? "reconnecting" : "connecting");
    if (isReconnect) {
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

    // RESUME is the literal first frame on a fresh connection when we have
    // a previous turn's last rendered seq.
    const resume = buildResumeMessage();
    if (resume) {
      this.sendRaw(resume);
      store.appendEvent({
        id: `tl_resume_${Date.now()}`,
        kind: "resume",
        seq: 0,
        at: Date.now(),
        lastSeq: resume.last_seq,
      });
      store.setIsResuming(true);
    }
  }

  private onMessage(ev: MessageEvent): void {
    const data = ev.data;
    if (typeof data !== "string") {
      // The server only sends text frames; anything else is a protocol
      // violation we cannot meaningfully surface. Drop silently.
      return;
    }
    routeRawFrame(data, {
      send: (msg) => this.sendRaw(msg),
      onParseError: (raw) => {
        getStore().appendEvent({
          id: `tl_err_${Date.now()}`,
          kind: "error",
          seq: 0,
          at: Date.now(),
          code: "PARSE_ERROR",
          message: raw.slice(0, 200),
        });
      },
      onToolAckSent: () => {
        this.heartbeat.onToolAckSent();
      },
    });
  }

  private onError(): void {
    // Browsers fire error immediately before close; the close handler is
    // the source of truth for reconnection.
  }

  private onClose(ev: CloseEvent): void {
    if (this.intentionalClose) return;
    const reason = ev.reason || `code_${ev.code}`;
    getStore().onConnectionDrop(reason, Date.now());
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectAttempts++;
    // jitterMultiplier returns a number in [0.75, 1.25]; we multiply the
    // capped backoff by it. Tests pass an explicit 1.0 for determinism.
    const delay = Math.min(
      this.maxBackoffMs,
      nextDelay(this.reconnectAttempts, jitterMultiplier()),
    );
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

  private sendRaw(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
      if (msg.type === "PONG") {
        this.heartbeat.onPongSent(Date.now());
      }
    } catch {
      // Best effort; the close handler will reconnect.
    }
  }
}

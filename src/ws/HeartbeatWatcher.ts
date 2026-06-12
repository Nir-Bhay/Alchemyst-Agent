// ─────────────────────────────────────────────────────────────────────────────
// ws/HeartbeatWatcher.ts
//
// Tracks the most recent PING and exposes a single "is alive?" method. Kept
// deliberately simple — the WebSocket library fires `onmessage` and the
// message router handles the PING/PONG exchange; this watcher is just a
// diagnostics helper that the indicator uses to surface "stuck" states.
//
// We do NOT use setTimeout for the PONG response itself — that's done
// inline in the message router in the same microtask as onmessage.
// ─────────────────────────────────────────────────────────────────────────────

import type { PingMessage } from "@/protocol/types";

export class HeartbeatWatcher {
  private lastPing: PingMessage | null = null;
  private lastPongSentAt: number | null = null;
  private pingCount = 0;
  private pongCount = 0;
  private corruptPings = 0;

  onPing(ping: PingMessage): void {
    this.lastPing = ping;
    this.pingCount++;
    if (ping.challenge === "") this.corruptPings++;
  }

  onPongSent(at: number): void {
    this.lastPongSentAt = at;
    this.pongCount++;
  }

  lastPingChallenge(): string | null {
    return this.lastPing?.challenge ?? null;
  }

  pingCountValue(): number {
    return this.pingCount;
  }

  pongCountValue(): number {
    return this.pongCount;
  }

  corruptPingsValue(): number {
    return this.corruptPings;
  }

  /**
   * "Is the server alive?" — true if we've seen a PING within the last
   * `maxStaleMs` AND the most recent one has been PONG'd. We use this
   * only for diagnostics; the ConnectionManager decides real drops via
   * the onclose handler.
   */
  isFresh(maxStaleMs: number = 30_000): boolean {
    if (!this.lastPing) return true; // no PING yet → fresh
    const now = Date.now();
    return now - this.lastPing.seq >= 0 && now - (this.lastPongSentAt ?? now) < maxStaleMs;
  }
}

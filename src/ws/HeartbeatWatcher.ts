// HeartbeatWatcher
//
// Diagnostics for the heartbeat exchange. PING/PONG itself happens inline
// in messageRouter.ts so the PONG is sent in the same microtask as the
// onmessage callback — we do not need (and do not want) a setTimeout here.
//
// This class is purely for the connection indicator. The real drop
// detection is on the socket's close event.

import type { PingMessage } from "@/protocol/types";

export class HeartbeatWatcher {
  private lastPing: PingMessage | null = null;
  private lastPongSentAt: number | null = null;
  private lastPingReceivedAt = 0;
  private pingCount = 0;
  private pongCount = 0;
  private toolAckCount = 0;
  private corruptPings = 0;

  onPing(ping: PingMessage, receivedAt: number): void {
    this.lastPing = ping;
    this.lastPingReceivedAt = receivedAt;
    this.pingCount++;
    if (ping.challenge === "") this.corruptPings++;
  }

  onPongSent(at: number): void {
    this.lastPongSentAt = at;
    this.pongCount++;
  }

  onToolAckSent(): void {
    this.toolAckCount++;
  }

  pingCountValue(): number {
    return this.pingCount;
  }

  pongCountValue(): number {
    return this.pongCount;
  }

  toolAckCountValue(): number {
    return this.toolAckCount;
  }

  corruptPingsValue(): number {
    return this.corruptPings;
  }

  /**
   * "Is the server alive?" — true if the most recent PING has been PONG'd
   * within the last `maxStaleMs`. We use this only for diagnostics; the
   * ConnectionManager decides real drops via the onclose handler.
   */
  isFresh(maxStaleMs: number = 30_000): boolean {
    if (this.lastPongSentAt === null) return true;
    return Date.now() - this.lastPongSentAt < maxStaleMs;
  }

  lastRttMs(): number | null {
    if (this.lastPing === null || this.lastPongSentAt === null) return null;
    return Math.max(0, this.lastPongSentAt - this.lastPingReceivedAt);
  }
}

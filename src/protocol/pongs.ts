// ─────────────────────────────────────────────────────────────────────────────
// pongs.ts
//
// Pure helper for building a PONG message in response to a PING. The spec
// is unambiguous: the `echo` field must be the verbatim `challenge` string
// from the PING, including the empty string case. We do not sanitise or
// transform the challenge.
//
// The reason this is a separate module: the empty-string case is easy to
// miss in `if/else` chains, and the server *will* log `verdict:
// wrong_challenge` if it doesn't get a PONG (even with echo=""). We must
// reply with literally `{ type: "PONG", echo: "" }` and not, e.g., skip
// the PONG or send a PONG without an echo field.
// ─────────────────────────────────────────────────────────────────────────────

import type { PingMessage, PongPayload } from "./types";

export function buildPong(ping: PingMessage): PongPayload {
  return { type: "PONG", echo: ping.challenge };
}

export function buildPongFromChallenge(challenge: string): PongPayload {
  return { type: "PONG", echo: challenge };
}

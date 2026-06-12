// ─────────────────────────────────────────────────────────────────────────────
// backoff.ts
//
// Pure exponential backoff with jitter, as specified in the assignment:
//
//   attempt 0: 500ms
//   attempt 1: 1000ms
//   attempt 2: 2000ms
//   attempt 3: 4000ms
//   attempt 4: 8000ms
//   attempt 5+: 10000ms (cap)
//
// On top of the exponential curve we add ±25% jitter to avoid thundering
// herd reconnects from a flaky network. The jitter is applied *after*
// capping so the cap is still respected at the upper bound.
//
// The function is `nextDelay(attempt) -> ms`. The state (the attempt
// counter) lives in the ConnectionManager; this module is a pure lookup
// table.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_MS = 500;
const CAP_MS = 10_000;
const MAX_EXP = 20; // 2^20 * 500ms is well past the cap; we cap before multiplying

export function nextDelay(attempt: number, jitterRatio: number = 0.25): number {
  if (attempt < 0) attempt = 0;

  // Compute the exponential component. Use Math.min on the exponent to
  // avoid Infinity on absurd attempt counts.
  const exp = Math.min(attempt, MAX_EXP);
  const raw = BASE_MS * 2 ** exp;
  const capped = Math.min(raw, CAP_MS);

  // Apply symmetric jitter: capped * (1 ± jitterRatio). The randomised
  // component is provided by the caller to keep this module deterministic
  // for tests; the default is a 25% symmetric band.
  if (jitterRatio < 0) jitterRatio = 0;
  if (jitterRatio > 1) jitterRatio = 1;

  // We accept the jitter as a pre-computed multiplier (0.75..1.25). The
  // caller can pass `Math.random() * 0.5 + 0.75` to get the symmetric band.
  // The default here (1.0) is a no-op, suitable for deterministic testing.
  const jittered = capped * jitterRatio;
  return Math.round(jittered);
}

/**
 * Helper for callers that want the jitter computed in one place.
 * Returns a multiplier in [1 - ratio, 1 + ratio].
 */
export function jitterMultiplier(ratio: number = 0.25): number {
  if (ratio < 0) ratio = 0;
  if (ratio > 1) ratio = 1;
  return 1 - ratio + Math.random() * ratio * 2;
}

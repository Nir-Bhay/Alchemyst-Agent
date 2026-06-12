// backoff
//
// Pure exponential backoff with symmetric jitter, as the assignment
// specifies:
//
//   attempt 0: 500ms
//   attempt 1: 1s
//   attempt 2: 2s
//   attempt 3: 4s
//   attempt 4+: capped at 10s
//
// The jitter multiplier is provided by the caller; this module is
// deliberately test-deterministic — no `Math.random` here.

const BASE_MS = 500;
const CAP_MS = 10_000;
// Past 2^20 * 500ms we are well past the cap. Clamp the exponent so
// absurd attempt counts cannot produce Infinity.
const MAX_EXP = 20;

/**
 * Compute the next reconnect delay in milliseconds.
 *
 * @param attempt Zero-based attempt index.
 * @param multiplier Pre-computed jitter multiplier in [0, ~1.25]. Tests
 *   pass `1.0` for determinism; production callers use `jitterMultiplier()`.
 */
export function nextDelay(attempt: number, multiplier: number = 1.0): number {
  if (attempt < 0) attempt = 0;
  if (multiplier < 0) multiplier = 0;
  // Clamp the multiplier to 1.0. A jitter multiplier > 1 would be a
  // longer wait than the unscaled cap, which defeats the point of the
  // cap. jitterMultiplier() always returns a value in [1 - ratio, 1 + ratio]
  // with ratio <= 1 by default, so this clamp is a safety net for callers
  // that pre-compute their own multipliers.
  if (multiplier > 1) multiplier = 1;

  const exp = Math.min(attempt, MAX_EXP);
  const raw = BASE_MS * 2 ** exp;
  const capped = Math.min(raw, CAP_MS);
  return Math.round(capped * multiplier);
}

/**
 * Symmetric jitter multiplier in `[1 - ratio, 1 + ratio]`. Default 0.25
 * gives the ±25% band documented in DECISIONS.md.
 */
export function jitterMultiplier(ratio: number = 0.25): number {
  if (ratio < 0) ratio = 0;
  if (ratio > 1) ratio = 1;
  return 1 - ratio + Math.random() * ratio * 2;
}

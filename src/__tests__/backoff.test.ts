import { describe, it, expect } from "vitest";
import { nextDelay, jitterMultiplier } from "@/lib/backoff";

describe("backoff", () => {
  it("follows the assignment's exponential schedule (no jitter)", () => {
    expect(nextDelay(0, 1.0)).toBe(500);
    expect(nextDelay(1, 1.0)).toBe(1000);
    expect(nextDelay(2, 1.0)).toBe(2000);
    expect(nextDelay(3, 1.0)).toBe(4000);
    expect(nextDelay(4, 1.0)).toBe(8000);
    expect(nextDelay(5, 1.0)).toBe(10000);
    expect(nextDelay(6, 1.0)).toBe(10000); // cap
    expect(nextDelay(10, 1.0)).toBe(10000);
    expect(nextDelay(100, 1.0)).toBe(10000);
  });

  it("applies the jitter multiplier", () => {
    // With jitterRatio=0.5 the result is 10000*0.5 = 5000
    expect(nextDelay(5, 0.5)).toBe(5000);
    // With jitterRatio=2.0 the implementation clamps to 1.0, so the
    // result is the un-jittered cap: 10000.
    expect(nextDelay(5, 2.0)).toBe(10000);
  });

  it("treats negative attempts as zero", () => {
    expect(nextDelay(-3, 1.0)).toBe(500);
  });

  it("jitterMultiplier stays within [1-ratio, 1+ratio]", () => {
    for (let i = 0; i < 50; i++) {
      const m = jitterMultiplier(0.25);
      expect(m).toBeGreaterThanOrEqual(0.75);
      expect(m).toBeLessThanOrEqual(1.25);
    }
  });

  it("jitterMultiplier with ratio 0 returns exactly 1", () => {
    for (let i = 0; i < 5; i++) {
      expect(jitterMultiplier(0)).toBe(1);
    }
  });
});

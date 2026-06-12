import { describe, it, expect } from "vitest";
import { Dedup } from "@/protocol/dedup";

describe("Dedup", () => {
  it("starts empty", () => {
    const d = new Dedup();
    expect(d.size()).toBe(0);
    expect(d.highestRendered()).toBe(0);
    expect(d.has(1)).toBe(false);
  });

  it("marks rendered seqs and reports the highest", () => {
    const d = new Dedup();
    expect(d.markRendered(5)).toBe(true);
    expect(d.markRendered(2)).toBe(true);
    expect(d.markRendered(5)).toBe(false);
    expect(d.highestRendered()).toBe(5);
    expect(d.size()).toBe(2);
  });

  it("notes received without marking rendered", () => {
    const d = new Dedup();
    d.noteReceived(10);
    d.noteReceived(3);
    expect(d.highestReceived()).toBe(10);
    expect(d.highestRendered()).toBe(0);
    expect(d.has(10)).toBe(false);
    expect(d.has(3)).toBe(false);
  });

  it("hydrates from a prior state", () => {
    const d = new Dedup();
    d.hydrate(7, [5, 6, 7]);
    expect(d.highestRendered()).toBe(7);
    expect(d.has(5)).toBe(true);
    expect(d.has(6)).toBe(true);
    expect(d.has(7)).toBe(true);
    expect(d.has(8)).toBe(false);
  });

  it("highestRendered never regresses when a smaller seq is rendered", () => {
    const d = new Dedup();
    d.markRendered(10);
    d.markRendered(2); // lower seq — should not move the high-water mark
    expect(d.highestRendered()).toBe(10);
  });

  it("noteReceived and markRendered track separate maxima", () => {
    const d = new Dedup();
    d.noteReceived(20);
    d.markRendered(5);
    expect(d.highestReceived()).toBe(20);
    expect(d.highestRendered()).toBe(5);
  });
});

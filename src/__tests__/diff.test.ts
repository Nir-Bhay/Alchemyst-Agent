import { describe, it, expect } from "vitest";
import { diffObjects, isEqual, classifyKey } from "@/protocol/diff";

describe("diff", () => {
  it("returns empty diff for identical objects", () => {
    const a = { x: 1, y: 2 };
    const b = { x: 1, y: 2 };
    const d = diffObjects(a, b);
    expect(d.addedKeys).toEqual([]);
    expect(d.removedKeys).toEqual([]);
    expect(d.changedKeys).toEqual([]);
  });

  it("detects added keys", () => {
    const a = { x: 1 };
    const b = { x: 1, y: 2 };
    const d = diffObjects(a, b);
    expect(d.addedKeys).toEqual(["y"]);
    expect(d.removedKeys).toEqual([]);
    expect(d.changedKeys).toEqual([]);
  });

  it("detects removed keys", () => {
    const a = { x: 1, y: 2 };
    const b = { x: 1 };
    const d = diffObjects(a, b);
    expect(d.removedKeys).toEqual(["y"]);
    expect(d.addedKeys).toEqual([]);
    expect(d.changedKeys).toEqual([]);
  });

  it("detects changed keys", () => {
    const a = { x: 1, y: 2 };
    const b = { x: 1, y: 3 };
    const d = diffObjects(a, b);
    expect(d.changedKeys).toEqual(["y"]);
    expect(d.addedKeys).toEqual([]);
    expect(d.removedKeys).toEqual([]);
  });

  it("sorts the result arrays", () => {
    const a = { z: 1, a: 1 };
    const b = { z: 1, a: 2, m: 1, b: 1 };
    const d = diffObjects(a, b);
    expect(d.addedKeys).toEqual(["b", "m"]);
    expect(d.changedKeys).toEqual(["a"]);
  });

  it("isEqual is deep and handles arrays", () => {
    expect(isEqual({ a: [1, 2, 3] }, { a: [1, 2, 3] })).toBe(true);
    expect(isEqual({ a: [1, 2, 3] }, { a: [1, 2, 4] })).toBe(false);
    expect(isEqual(null, null)).toBe(true);
    expect(isEqual(null, undefined)).toBe(false);
    expect(isEqual(1, "1")).toBe(false);
  });

  it("classifyKey returns added/removed/changed/unchanged", () => {
    const d = diffObjects({ x: 1, y: 2 }, { x: 1, y: 3, z: 4 });
    // 'z' is present in B but not in A → 'added'
    expect(classifyKey("z", d, false, true)).toBe("added");
    // 'x' removed (in A, not in B) → 'removed'
    expect(classifyKey("x", d, true, false)).toBe("removed");
    // 'y' present in both with different value → 'changed'
    expect(classifyKey("y", d, true, true)).toBe("changed");
    // 'w' present in both with same value → 'unchanged'
    expect(classifyKey("w", d, true, true)).toBe("unchanged");
  });
});

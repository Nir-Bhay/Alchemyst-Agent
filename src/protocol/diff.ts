// ─────────────────────────────────────────────────────────────────────────────
// diff.ts
//
// Pure JSON diff. Compares two `Readonly<Record<string, unknown>>` values
// and returns a structured description of:
//
//   - addedKeys:    keys present in `b` but not in `a`
//   - removedKeys:  keys present in `a` but not in `b`
//   - changedKeys:  keys present in both with different values
//
// For large values we do *not* do a full recursive LCS — that would not
// fit the "550KB in one render" budget. We compare JSON-serialized forms
// for "are these equal?" and only descend into objects/arrays that are
// present in both. Object equality is computed by structural reference for
// the "changed" classification.
//
// The result is used by the context inspector to render `+` / `-` / `~`
// markers on tree nodes.
// ─────────────────────────────────────────────────────────────────────────────

export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface ObjectDiff {
  readonly addedKeys: ReadonlyArray<string>;
  readonly removedKeys: ReadonlyArray<string>;
  readonly changedKeys: ReadonlyArray<string>;
}

const EMPTY: ObjectDiff = { addedKeys: [], removedKeys: [], changedKeys: [] };

/**
 * Compare two objects structurally. Both are treated as `Record<string,
 * unknown>` at the top level (context data is always an object per the
 * server types).
 *
 * For nested objects/arrays we keep the diff shallow — a key is "changed"
 * if its JSON serialization differs. We do not descend further. The
 * tree view does a per-node compare on render.
 */
export function diffObjects(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): ObjectDiff {
  if (a === b) return EMPTY;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  const aSet = new Set(aKeys);
  const bSet = new Set(bKeys);

  const addedKeys: string[] = [];
  for (const k of bKeys) {
    if (!aSet.has(k)) addedKeys.push(k);
  }

  const removedKeys: string[] = [];
  for (const k of aKeys) {
    if (!bSet.has(k)) removedKeys.push(k);
  }

  const changedKeys: string[] = [];
  for (const k of aKeys) {
    if (!bSet.has(k)) continue;
    if (!isEqual(a[k], b[k])) changedKeys.push(k);
  }

  addedKeys.sort();
  removedKeys.sort();
  changedKeys.sort();
  return { addedKeys, removedKeys, changedKeys };
}

/**
 * Per-node equality check used by the tree view. Compares JSON serialization
 * lengths first (fast reject) then full serialization for the actual
 * comparison. We deliberately do NOT recursively diff — only the top level
 * matters for status icons; deeper detail is in the per-key tree view.
 */
export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;

  if (typeof a === "object" && typeof b === "object") {
    const aRec = a as Record<string, unknown>;
    const bRec = b as Record<string, unknown>;
    const aKeys = Object.keys(aRec);
    const bKeys = Object.keys(bRec);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bRec, k)) return false;
      if (!isEqual(aRec[k], bRec[k])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Classify a single key relative to a previous diff. Used by the tree view
 * to render per-node status badges.
 */
export function classifyKey(
  key: string,
  diff: ObjectDiff,
  presentInA: boolean,
  presentInB: boolean,
): DiffStatus {
  if (!presentInA && presentInB) return "added";
  if (presentInA && !presentInB) return "removed";
  if (diff.changedKeys.includes(key)) return "changed";
  return "unchanged";
}

/**
 * Size estimate for tree expansion heuristics. Returns a rough byte count.
 */
export function approxByteSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

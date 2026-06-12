// ─────────────────────────────────────────────────────────────────────────────
// state/slices/contexts.ts
//
// Per-context history. For each `context_id` we keep a list of snapshots
// (each tagged with its `seq`) and a `cursor` (which snapshot the scrubber
// is currently displaying). Diffs between consecutive snapshots are
// precomputed and cached — recomputing on every scrub move is wasteful for
// 550KB payloads.
//
// The scrubber is purely a UI pointer into the snapshot array; the diff
// is always `snapshot[i] vs snapshot[i-1]` for the displayed snapshot.
// ─────────────────────────────────────────────────────────────────────────────

import type { ObjectDiff } from "@/protocol/diff";
import { diffObjects } from "@/protocol/diff";
import type { Seq } from "@/protocol/types";

export interface ContextSnapshot {
  readonly seq: Seq;
  readonly at: number;
  readonly data: Readonly<Record<string, unknown>>;
  /** Pre-computed diff vs the previous snapshot (null for the first). */
  readonly diff: ObjectDiff | null;
  /** JSON size in bytes (cached for display). */
  readonly sizeBytes: number;
}

export interface ContextHistory {
  readonly context_id: string;
  readonly snapshots: ReadonlyArray<ContextSnapshot>;
  readonly cursor: number;
}

export interface ContextsSlice {
  readonly contexts: ReadonlyMap<string, ContextHistory>;
  readonly activeContextId: string | null;
  readonly setActiveContextId: (id: string | null) => void;
  readonly appendContextSnapshot: (
    contextId: string,
    seq: Seq,
    data: Readonly<Record<string, unknown>>,
    at: number,
  ) => void;
  readonly setContextCursor: (contextId: string, cursor: number) => void;
  readonly resetContexts: () => void;
}

function approxSizeBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export function makeContextsSlice(
  set: (fn: (s: ContextsSlice) => Partial<ContextsSlice>) => void,
): ContextsSlice {
  return {
    contexts: new Map(),
    activeContextId: null,
    setActiveContextId: (id) => set(() => ({ activeContextId: id })),
    appendContextSnapshot: (contextId, seq, data, at) =>
      set((s) => {
        const existing = s.contexts.get(contextId);
        const prev = existing?.snapshots[existing.snapshots.length - 1];
        const diff = prev ? diffObjects(prev.data, data) : null;
        const newSnapshot: ContextSnapshot = {
          seq,
          at,
          data,
          diff,
          sizeBytes: approxSizeBytes(data),
        };
        const newHistory: ContextHistory = existing
          ? {
              context_id: contextId,
              snapshots: [...existing.snapshots, newSnapshot],
              // Keep cursor at the latest snapshot on append.
              cursor: existing.snapshots.length, // index of new snapshot
            }
          : {
              context_id: contextId,
              snapshots: [newSnapshot],
              cursor: 0,
            };
        const newMap = new Map(s.contexts);
        newMap.set(contextId, newHistory);
        return { contexts: newMap, activeContextId: contextId };
      }),
    setContextCursor: (contextId, cursor) =>
      set((s) => {
        const existing = s.contexts.get(contextId);
        if (!existing) return s;
        if (cursor < 0 || cursor >= existing.snapshots.length) return s;
        const newMap = new Map(s.contexts);
        newMap.set(contextId, { ...existing, cursor });
        return { contexts: newMap };
      }),
    resetContexts: () =>
      set(() => ({
        contexts: new Map(),
        activeContextId: null,
      })),
  };
}

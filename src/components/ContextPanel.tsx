"use client";

import { useMemo, useState, useEffect } from "react";
import {
  useContexts,
  useActiveContextId,
  useActiveStreamId,
} from "@/state/selectors";
import { useAppStore } from "@/state/store";
import type { ContextHistory } from "@/state/slices/contexts";
import { JsonTreeView } from "./JsonTreeView";
import { cx, shortNumber } from "@/lib/dom";

export function ContextPanel() {
  const contexts = useContexts();
  const activeContextId = useActiveContextId();
  const activeStreamId = useActiveStreamId();
  const setActive = useAppStore((s) => s.setActiveContextId);
  const setCursor = useAppStore((s) => s.setContextCursor);

  const history = activeContextId ? contexts.get(activeContextId) ?? null : null;

  // If no active context but we have one, switch to it.
  useEffect(() => {
    if (!activeContextId && contexts.size > 0) {
      const first = contexts.keys().next().value;
      if (typeof first === "string") setActive(first);
    }
  }, [activeContextId, contexts, setActive]);

  // Pick the context that matches the most recent stream (heuristic).
  useEffect(() => {
    if (!activeStreamId) return;
    // No direct mapping from stream_id to context_id; we just keep
    // the latest context that arrived. The active context is set by
    // the context slice on every CONTEXT_SNAPSHOT append, so this
    // effect is mostly a no-op.
  }, [activeStreamId]);

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-line bg-bg">
      <div className="flex items-center justify-between border-b border-line bg-bg-panel px-3 py-2 text-sm font-semibold text-ink">
        <span>Context inspector</span>
        <span className="text-xs text-ink-faint">{contexts.size} ctx</span>
      </div>
      <ContextTabs
        contexts={Array.from(contexts.values()).map((c) => ({
          id: c.context_id,
          count: c.snapshots.length,
          size: c.snapshots[c.snapshots.length - 1]?.sizeBytes ?? 0,
        }))}
        activeId={activeContextId}
        onSelect={setActive}
      />
      {history ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Scrubber
            count={history.snapshots.length}
            cursor={history.cursor}
            onChange={(i) => setCursor(history.context_id, i)}
          />
          <div className="flex min-h-0 flex-1 flex-col">
            <SnapshotView history={history} />
          </div>
        </div>
      ) : (
        <div className="p-4 text-xs text-ink-faint">
          No context snapshots yet. Ask the agent to load a context.
        </div>
      )}
    </div>
  );
}

interface ContextTab {
  readonly id: string;
  readonly count: number;
  readonly size: number;
}

function ContextTabs({
  contexts,
  activeId,
  onSelect,
}: {
  contexts: ReadonlyArray<ContextTab>;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (contexts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 border-b border-line bg-bg-panel px-2 py-1">
      {contexts.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c.id)}
          className={cx(
            "rounded border px-2 py-0.5 font-mono text-[11px]",
            activeId === c.id
              ? "border-accent bg-accent/10 text-accent"
              : "border-line text-ink-dim hover:text-ink",
          )}
          title={`${c.count} snapshots · ${shortNumber(c.size)}B`}
        >
          {c.id}
        </button>
      ))}
    </div>
  );
}

function Scrubber({
  count,
  cursor,
  onChange,
}: {
  count: number;
  cursor: number;
  onChange: (i: number) => void;
}) {
  if (count <= 1) return null;
  return (
    <div className="flex items-center gap-2 border-b border-line bg-bg-panel px-3 py-1 text-[11px] text-ink-dim">
      <button
        type="button"
        className="rounded border border-line px-1.5 hover:text-ink"
        onClick={() => onChange(Math.max(0, cursor - 1))}
        disabled={cursor === 0}
      >
        ‹
      </button>
      <span className="font-mono text-ink">
        {cursor + 1} / {count}
      </span>
      <button
        type="button"
        className="rounded border border-line px-1.5 hover:text-ink"
        onClick={() => onChange(Math.min(count - 1, cursor + 1))}
        disabled={cursor === count - 1}
      >
        ›
      </button>
      <input
        type="range"
        min={0}
        max={count - 1}
        value={cursor}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="flex-1 accent-accent"
      />
    </div>
  );
}

function SnapshotView({
  history,
}: {
  history: ContextHistory;
}) {
  const snap = history.snapshots[history.cursor];
  const prev = history.cursor > 0 ? history.snapshots[history.cursor - 1] : null;
  // Recompute a diff against prev if the snapshot's pre-computed diff
  // is for a different pair (i.e., user scrubbed back). We do this
  // lazily by looking at the snapshot's `diff` field — which is always
  // `snap[i] vs snap[i-1]`. When the cursor is i, that's exactly the
  // diff we want.
  const diff = useMemo(() => {
    if (!snap || !snap.diff) return null;
    return {
      added: snap.diff.addedKeys,
      removed: snap.diff.removedKeys,
      changed: snap.diff.changedKeys,
    };
  }, [snap]);

  if (!snap) {
    return <div className="p-4 text-xs text-ink-faint">Empty context.</div>;
  }
  void prev;

  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-bg-panel px-3 py-1 text-[11px] text-ink-faint">
        <span>
          snapshot #{history.cursor + 1} of {history.snapshots.length} · seq {snap.seq}
        </span>
        <span>{shortNumber(snap.sizeBytes)}B</span>
      </div>
      <div className="min-h-0 flex-1">
        <JsonTreeView data={snap.data} diffKeys={diff} />
      </div>
    </>
  );
}

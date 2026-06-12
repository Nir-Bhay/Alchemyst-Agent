// selectors
//
// Fine-grained selector helpers. Each component imports the selector
// that exactly matches what it renders; Zustand's default
// `useStore(selector)` compares the selector's return value with `===`
// and re-renders only on actual change.
//
// For derived arrays/objects we wrap with `useShallow` so the equality
// check is element-wise — otherwise `.filter()` would return a new
// reference on every store change and re-render the panel on every
// token.

import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";
import { useAppStore } from "./store";
import type { TimelineRow, TimelineRowKind } from "./slices/timeline";
import type { AppStore } from "./store";

// ── Chat selectors ──────────────────────────────────────────────────────────

export function useStreamsList(): ReadonlyArray<string> {
  return useAppStore((s: AppStore) => s.streamOrder);
}

export function useStream(streamId: string) {
  return useAppStore((s: AppStore) => s.streams.get(streamId));
}

export function useActiveStreamId(): string | null {
  return useAppStore((s: AppStore) => {
    for (let i = s.streamOrder.length - 1; i >= 0; i--) {
      const id = s.streamOrder[i];
      if (id === undefined) continue;
      const st = s.streams.get(id);
      if (st && !st.streamEnded) return id;
    }
    const last = s.streamOrder[s.streamOrder.length - 1];
    return last ?? null;
  });
}

// ── Timeline selectors ──────────────────────────────────────────────────────

export function useTimelineFilter(): { readonly kinds: ReadonlySet<TimelineRowKind>; readonly search: string } {
  return useAppStore(
    useShallow((s: AppStore) => ({ kinds: s.timelineFilter.kinds, search: s.timelineFilter.search })),
  );
}

/**
 * Filtered + searched timeline rows. The dependency on `timeline` and
 * `timelineFilter` is tracked here: the filter result is memoized so
 * unrelated store changes (e.g. a token for an off-screen stream) do not
 * recompute or re-render the timeline panel.
 */
export function useFilteredTimeline(): ReadonlyArray<TimelineRow> {
  const timeline = useAppStore((s: AppStore) => s.timeline);
  const filter = useAppStore(
    useShallow((s: AppStore) => ({ kinds: s.timelineFilter.kinds, search: s.timelineFilter.search })),
  );
  return useMemo(() => {
    if (filter.kinds.size === 0) return [];
    if (filter.search.length === 0) {
      return timeline.filter((r) => filter.kinds.has(r.kind));
    }
    const lower = filter.search.toLowerCase();
    return timeline.filter((r) => {
      if (!filter.kinds.has(r.kind)) return false;
      return rowMatchesSearch(r, lower);
    });
  }, [timeline, filter]);
}

function rowMatchesSearch(row: TimelineRow, lower: string): boolean {
  switch (row.kind) {
    case "token_batch":
      return row.text.toLowerCase().includes(lower);
    case "tool_call":
      return (
        row.toolName.toLowerCase().includes(lower) ||
        row.argsPreview.toLowerCase().includes(lower) ||
        row.callId.toLowerCase().includes(lower)
      );
    case "tool_result":
      return (
        row.resultPreview.toLowerCase().includes(lower) ||
        row.callId.toLowerCase().includes(lower)
      );
    case "context_snapshot":
      return row.contextId.toLowerCase().includes(lower);
    case "stream_end":
      return row.streamId.toLowerCase().includes(lower);
    case "ping":
      return row.challenge.toLowerCase().includes(lower);
    case "pong":
      return row.echo.toLowerCase().includes(lower);
    case "error":
      return row.code.toLowerCase().includes(lower) || row.message.toLowerCase().includes(lower);
    case "resume":
      return String(row.lastSeq).includes(lower);
    case "reconnect":
      return String(row.attempt).includes(lower);
    case "disconnect":
      return row.reason.toLowerCase().includes(lower);
  }
}

export function useHighlightedEventId(): string | null {
  return useAppStore((s: AppStore) => s.highlightedEventId);
}

// ── Connection selectors ────────────────────────────────────────────────────

export function useConnection() {
  return useAppStore((s: AppStore) => s.connection);
}

// ── Counters ────────────────────────────────────────────────────────────────

export function useCounters() {
  return useAppStore(
    useShallow((s: AppStore) => ({
      highestReceivedSeq: s.counters.highestReceivedSeq,
      highestRenderedSeq: s.counters.highestRenderedSeq,
    })),
  );
}

// ── Context selectors ───────────────────────────────────────────────────────

export function useContexts() {
  return useAppStore((s: AppStore) => s.contexts);
}

export function useActiveContextId(): string | null {
  return useAppStore((s: AppStore) => s.activeContextId);
}

// ── Filter helpers (exported for FilterBar) ────────────────────────────────

export function setFilter(
  kinds: ReadonlySet<TimelineRowKind>,
  search: string,
): void {
  useAppStore.setState({ timelineFilter: { kinds, search } });
}

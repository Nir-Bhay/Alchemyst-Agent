// ─────────────────────────────────────────────────────────────────────────────
// state/selectors.ts
//
// Fine-grained selector helpers. Components import these instead of reading
// `useAppStore` directly so that subscription scope is obvious at the
// call site. Each selector returns a derived value; Zustand's default
// `useStore(selector)` does a referential equality check on the result
// and re-renders only if it changed.
//
// Selectors that return a derived object MUST be wrapped in a custom
// equality function (we do that with `useShallow` from `zustand/shallow`)
// to avoid re-rendering when the underlying fields didn't change.
// ─────────────────────────────────────────────────────────────────────────────

import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "./store";
import type { TimelineRow, TimelineRowKind } from "./slices/timeline";
import type { TimelineFilter } from "./slices/timeline";
import type { AppStore } from "./store";

// ── Chat selectors ──────────────────────────────────────────────────────────

export function useStreamsList(): ReadonlyArray<string> {
  return useAppStore((s: AppStore) => s.streamOrder);
}

export function useStream(streamId: string) {
  // Return the full stream state. The component is responsible for
  // being smart about which fields it actually re-renders on; for the
  // chat text we use an imperative subscription in StreamBubble so
  // re-renders are cheap (the DOM text content is not in JSX).
  return useAppStore((s: AppStore) => s.streams.get(streamId));
}

export function useActiveStreamId(): string | null {
  // The most recently updated stream whose `streamEnded` is false.
  // If none, return the last stream in order.
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

export function useTimeline() {
  return useAppStore((s: AppStore) => s.timeline);
}

export function useTimelineFilter(): TimelineFilter {
  return useAppStore(useShallow((s: AppStore) => s.timelineFilter));
}

export function useFilteredTimeline(): ReadonlyArray<TimelineRow> {
  return useAppStore((s: AppStore) => {
    const { kinds, search } = s.timelineFilter;
    if (kinds.size === 0) return [];
    if (search.length === 0) return s.timeline.filter((r) => kinds.has(r.kind));
    const lower = search.toLowerCase();
    return s.timeline.filter((r) => {
      if (!kinds.has(r.kind)) return false;
      return rowMatchesSearch(r, lower);
    });
  });
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

export function useContextHistory(contextId: string | null) {
  return useAppStore((s: AppStore) => (contextId ? s.contexts.get(contextId) ?? null : null));
}

// ── Filter helpers (exported for FilterBar) ────────────────────────────────

export function setFilter(
  kinds: ReadonlySet<TimelineRowKind>,
  search: string,
): void {
  useAppStore.setState({ timelineFilter: { kinds, search } });
}
"use client";

import { ALL_TIMELINE_KINDS } from "@/state/slices/timeline";
import type { TimelineRowKind } from "@/state/slices/timeline";
import { setFilter, useTimelineFilter } from "@/state/selectors";
import { cx } from "@/lib/dom";

const KIND_LABEL: Record<TimelineRowKind, string> = {
  token_batch: "tokens",
  tool_call: "tool call",
  tool_result: "tool result",
  context_snapshot: "context",
  stream_end: "stream end",
  ping: "ping",
  pong: "pong",
  error: "error",
  resume: "resume",
  reconnect: "reconnect",
  disconnect: "disconnect",
};

export function FilterBar() {
  const filter = useTimelineFilter();
  const allOn = filter.kinds.size === ALL_TIMELINE_KINDS.size;
  const noneOn = filter.kinds.size === 0;

  const toggle = (kind: TimelineRowKind) => {
    const next = new Set(filter.kinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setFilter(next, filter.search);
  };

  const setAll = (on: boolean) => {
    setFilter(on ? new Set(ALL_TIMELINE_KINDS) : new Set(), filter.search);
  };

  return (
    <div className="flex flex-col gap-2 border-b border-line bg-bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setAll(!allOn)}
          className={cx(
            "rounded border px-2 py-0.5 text-[11px]",
            allOn
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-line text-ink-dim hover:text-ink",
          )}
        >
          {allOn ? "all" : noneOn ? "none" : "some"}
        </button>
        {(Object.keys(KIND_LABEL) as TimelineRowKind[]).map((k) => {
          const on = filter.kinds.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              className={cx(
                "rounded border px-2 py-0.5 text-[11px] font-mono",
                on
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line text-ink-faint hover:text-ink-dim",
              )}
            >
              {KIND_LABEL[k]}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={filter.search}
        onChange={(e) => setFilter(filter.kinds, e.target.value)}
        placeholder="search timeline…"
        className={cx(
          "rounded border border-line bg-bg-subtle px-2 py-1 text-xs",
          "text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none",
        )}
      />
    </div>
  );
}

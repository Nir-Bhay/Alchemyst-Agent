"use client";

import { useEffect, useRef, useState } from "react";
import type { ToolCardRecord } from "@/state/slices/streams";
import { cx, truncate } from "@/lib/dom";
import { useAppStore } from "@/state/store";

interface ToolCardProps {
  readonly card: ToolCardRecord;
  readonly streamId: string;
}

export function ToolCard({ card, streamId }: ToolCardProps) {
  const highlightedEventId = useAppStore((s) => s.highlightedEventId);
  const setHighlighted = useAppStore((s) => s.setHighlightedEventId);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const isHighlighted = highlightedEventId === `tool_${card.call_id}`;

  // Bidirectional-click: when the timeline highlights this card, scroll
  // it into view. We do this with a smooth scrollIntoView.
  useEffect(() => {
    if (isHighlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  return (
    <div
      ref={ref}
      data-call-id={card.call_id}
      data-stream-id={streamId}
      className={cx(
        "rounded-md border bg-bg-subtle px-3 py-2 text-sm transition-colors",
        card.droppedWhileWaiting
          ? "border-accent-warn/40"
          : card.status === "ok"
            ? "border-accent-ok/30"
            : "border-accent-tool/30",
        isHighlighted && "ring-2 ring-accent",
      )}
      onClick={() => setHighlighted(`tool_${card.call_id}`)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cx(
              "inline-block h-2 w-2 rounded-full",
              card.droppedWhileWaiting
                ? "bg-accent-warn animate-pulse-dot"
                : card.status === "ok"
                  ? "bg-accent-ok"
                  : "bg-accent-tool animate-pulse-dot",
            )}
          />
          <span className="font-mono text-ink">{card.tool_name}</span>
          <span className="font-mono text-xs text-ink-faint">{card.call_id}</span>
        </div>
        <button
          type="button"
          className="text-xs text-ink-dim hover:text-ink"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "collapse" : "expand"}
        </button>
      </div>
      {!expanded && (
        <div className="mt-1 font-mono text-xs text-ink-dim">
          {truncate(JSON.stringify(card.args), 200)}
        </div>
      )}
      {expanded && (
        <div className="mt-2 space-y-2 font-mono text-xs">
          <div>
            <div className="text-ink-faint">args</div>
            <pre className="overflow-x-auto rounded bg-bg px-2 py-1 text-ink-dim">
              {JSON.stringify(card.args, null, 2)}
            </pre>
          </div>
          {card.result && (
            <div>
              <div className="text-ink-faint">result</div>
              <pre className="overflow-x-auto rounded bg-bg px-2 py-1 text-ink-dim">
                {JSON.stringify(card.result, null, 2)}
              </pre>
            </div>
          )}
          {card.status === "pending" && !card.droppedWhileWaiting && (
            <div className="text-accent-tool">awaiting result…</div>
          )}
          {card.droppedWhileWaiting && (
            <div className="text-accent-warn">
              connection dropped; result will be replayed on reconnect
            </div>
          )}
        </div>
      )}
    </div>
  );
}

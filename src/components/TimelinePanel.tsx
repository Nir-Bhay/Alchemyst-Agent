"use client";

import { useEffect, useRef } from "react";
import { useFilteredTimeline } from "@/state/selectors";
import { useAppStore } from "@/state/store";
import type { TimelineRow } from "@/state/slices/timeline";
import { WindowedList } from "./windowed/WindowedList";
import { cx, shortNumber, truncate } from "@/lib/dom";

const ROW_HEIGHT = 26;

export function TimelinePanel() {
  const rows = useFilteredTimeline();
  const expandedRowId = useAppStore((s) => s.expandedRowId);
  const setExpanded = useAppStore((s) => s.setExpandedRowId);
  const setHighlighted = useAppStore((s) => s.setHighlightedEventId);
  const highlighted = useAppStore((s) => s.highlightedEventId);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new rows when the user is near the bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [rows.length]);

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-line bg-bg">
      <div className="border-b border-line bg-bg-panel px-3 py-2 text-sm font-semibold text-ink">
        Trace timeline <span className="text-xs text-ink-faint">({rows.length})</span>
      </div>
      <div
        ref={scrollerRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        data-testid="timeline-scroll"
      >
        {rows.length === 0 ? (
          <div className="p-4 text-xs text-ink-faint">No events match the filter.</div>
        ) : (
          <WindowedList
            rowCount={rows.length}
            rowHeight={ROW_HEIGHT}
            overscan={8}
            renderRow={(index) => {
              const row = rows[index];
              if (!row) return null;
              return (
                <TimelineRowView
                  row={row}
                  index={index}
                  isExpanded={expandedRowId === row.id}
                  isHighlighted={highlighted === eventIdForRow(row)}
                  onToggle={() =>
                    setExpanded(expandedRowId === row.id ? null : row.id)
                  }
                  onHighlight={() => setHighlighted(eventIdForRow(row))}
                />
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

function eventIdForRow(row: TimelineRow): string {
  if (row.kind === "tool_call" || row.kind === "tool_result") {
    return `tool_${row.callId}`;
  }
  if (row.kind === "token_batch") {
    return `stream_${row.streamId}`;
  }
  if (row.kind === "context_snapshot") {
    return `ctx_${row.contextId}_${row.seq}`;
  }
  return row.id;
}

interface TimelineRowViewProps {
  readonly row: TimelineRow;
  readonly index: number;
  readonly isExpanded: boolean;
  readonly isHighlighted: boolean;
  readonly onToggle: () => void;
  readonly onHighlight: () => void;
}

function TimelineRowView({
  row,
  index,
  isExpanded,
  isHighlighted,
  onToggle,
  onHighlight,
}: TimelineRowViewProps) {
  const meta = describe(row);
  return (
    <div
      style={{ height: ROW_HEIGHT }}
      data-row-id={row.id}
      className={cx(
        "flex items-center gap-2 border-b border-line/40 px-3 text-xs font-mono",
        isHighlighted && "bg-accent/15",
        index % 2 === 0 ? "bg-bg" : "bg-bg-subtle/40",
      )}
      onClick={onHighlight}
    >
      <span className="w-12 shrink-0 text-ink-faint">#{row.seq}</span>
      <span
        className={cx(
          "w-20 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase",
          meta.badgeCls,
        )}
      >
        {meta.badge}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink-dim">{meta.text}</span>
      {meta.canExpand && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="text-[10px] text-ink-faint hover:text-ink-dim"
        >
          {isExpanded ? "hide" : "show"}
        </button>
      )}
      {isExpanded && meta.expanded && (
        <div className="absolute left-3 right-3 z-10 mt-6 max-h-64 overflow-auto rounded border border-line bg-bg-panel p-2 text-[11px] text-ink-dim shadow-lg">
          <pre>{meta.expanded}</pre>
        </div>
      )}
    </div>
  );
}

function describe(row: TimelineRow): {
  badge: string;
  badgeCls: string;
  text: string;
  canExpand: boolean;
  expanded: string | null;
} {
  switch (row.kind) {
    case "token_batch":
      return {
        badge: "tokens",
        badgeCls: "bg-accent/15 text-accent",
        text: `${row.streamId} · ${shortNumber(row.tokenCount)} tok · ${truncate(row.text, 60)}`,
        canExpand: true,
        expanded: row.text,
      };
    case "tool_call":
      return {
        badge: "tool call",
        badgeCls: "bg-accent-tool/15 text-accent-tool",
        text: `${row.toolName}(${truncate(row.argsPreview, 40)})`,
        canExpand: true,
        expanded: row.argsPreview,
      };
    case "tool_result":
      return {
        badge: "tool result",
        badgeCls: "bg-accent-ok/15 text-accent-ok",
        text: `${row.callId} · ${truncate(row.resultPreview, 60)}`,
        canExpand: true,
        expanded: row.resultPreview,
      };
    case "context_snapshot":
      return {
        badge: "context",
        badgeCls: "bg-accent-warn/15 text-accent-warn",
        text: `${row.contextId} · ${shortNumber(row.sizeBytes)}B · ${row.keyCount} keys`,
        canExpand: false,
        expanded: null,
      };
    case "ping":
      return {
        badge: "ping",
        badgeCls: "bg-ink-faint/20 text-ink-dim",
        text: `challenge="${row.challenge}"`,
        canExpand: false,
        expanded: null,
      };
    case "pong":
      return {
        badge: "pong",
        badgeCls: "bg-ink-faint/20 text-ink-dim",
        text: `echo="${row.echo}"`,
        canExpand: false,
        expanded: null,
      };
    case "error":
      return {
        badge: "error",
        badgeCls: "bg-accent-err/15 text-accent-err",
        text: `${row.code} · ${truncate(row.message, 60)}`,
        canExpand: true,
        expanded: `${row.code}\n${row.message}`,
      };
    case "stream_end":
      return {
        badge: "end",
        badgeCls: "bg-ink-faint/20 text-ink-dim",
        text: row.streamId,
        canExpand: false,
        expanded: null,
      };
    case "resume":
      return {
        badge: "resume",
        badgeCls: "bg-accent/15 text-accent",
        text: `last_seq=${row.lastSeq}`,
        canExpand: false,
        expanded: null,
      };
    case "reconnect":
      return {
        badge: "reconnect",
        badgeCls: "bg-accent-warn/15 text-accent-warn",
        text: `attempt ${row.attempt}`,
        canExpand: false,
        expanded: null,
      };
    case "disconnect":
      return {
        badge: "disconnect",
        badgeCls: "bg-accent-err/15 text-accent-err",
        text: row.reason,
        canExpand: false,
        expanded: null,
      };
  }
}

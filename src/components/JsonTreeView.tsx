"use client";

import { useState, useMemo } from "react";

interface JsonTreeViewProps {
  readonly data: Readonly<Record<string, unknown>>;
  readonly diffKeys?: Readonly<{
    added: ReadonlyArray<string>;
    removed: ReadonlyArray<string>;
    changed: ReadonlyArray<string>;
  }> | null;
  readonly maxDepth?: number;
}

const TYPE_COLOR: Record<string, string> = {
  string: "text-emerald-300",
  number: "text-amber-300",
  boolean: "text-pink-300",
  null: "text-ink-faint",
  undefined: "text-ink-faint",
  object: "text-sky-300",
  array: "text-violet-300",
};

// Previews of large strings get truncated to keep the DOM lean. The
// full value is shown on the leaf's "show full" affordance in the future;
// for now, truncation prevents a 500KB string from rendering as a single
// text node that triggers a layout pass the size of the context panel.
const STRING_PREVIEW_LIMIT = 200;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function PreviewValue({ value }: { value: unknown }) {
  const t = typeOf(value);
  if (t === "string") {
    const s = String(value);
    if (s.length > STRING_PREVIEW_LIMIT) {
      return (
        <span className={TYPE_COLOR.string}>
          &quot;{s.slice(0, STRING_PREVIEW_LIMIT)}&quot; <span className="text-ink-faint">…({s.length} chars)</span>
        </span>
      );
    }
    return <span className={TYPE_COLOR.string}>&quot;{s}&quot;</span>;
  }
  if (t === "number" || t === "boolean") {
    return <span className={TYPE_COLOR[t]}>{String(value)}</span>;
  }
  if (t === "null" || t === "undefined") {
    return <span className={TYPE_COLOR[t]}>{t}</span>;
  }
  if (t === "array") {
    const arr = value as unknown[];
    return <span className={TYPE_COLOR.array}>Array({arr.length})</span>;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    return <span className={TYPE_COLOR.object}>Object({Object.keys(obj).length})</span>;
  }
  return <span>{String(value)}</span>;
}

interface NodeProps {
  readonly k: string | null;
  readonly value: unknown;
  readonly depth: number;
  readonly maxDepth: number;
  readonly status: "added" | "removed" | "changed" | "unchanged";
  readonly initiallyExpanded: boolean;
  readonly search: string;
}

function Node({ k, value, depth, maxDepth, status, initiallyExpanded, search }: NodeProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded || depth < 1);
  const t = typeOf(value);
  const isContainer = t === "object" || t === "array";
  const indent = depth * 12;

  const statusBadge = (() => {
    if (status === "added") return <span className="text-diff-add">+</span>;
    if (status === "removed") return <span className="text-diff-remove">-</span>;
    if (status === "changed") return <span className="text-diff-change">~</span>;
    return <span className="text-ink-faint"> </span>;
  })();

  const lowerSearch = search.toLowerCase();
  const text = k ?? "";
  const matchesSearch = search.length > 0 && text.toLowerCase().includes(lowerSearch);

  if (!isContainer || depth >= maxDepth) {
    return (
      <div
        className="flex items-start gap-1 font-mono text-[11px] leading-5"
        style={{ paddingLeft: indent }}
      >
        <span className="w-3 select-none text-center">{statusBadge}</span>
        {k !== null && (
          <span className={matchesSearch ? "bg-accent-warn/30 text-ink" : "text-sky-200"}>
            {k}:
          </span>
        )}
        <PreviewValue value={value} />
      </div>
    );
  }

  // Children are computed lazily on the first expand so the cost of
  // mapping over a 500KB array of primitives is paid once, not on every
  // re-render of the parent.
  const children = useMemo(() => {
    if (t === "array") {
      const arr = value as unknown[];
      return arr.map((v, i) => ({ k: String(i), v }));
    }
    const obj = value as Record<string, unknown>;
    return Object.keys(obj).map((key) => ({ k: key, v: obj[key] }));
  }, [value, t]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-1 text-left font-mono text-[11px] leading-5 hover:bg-bg-subtle"
        style={{ paddingLeft: indent }}
      >
        <span className="w-3 select-none text-center">{statusBadge}</span>
        <span className="text-ink-faint">{expanded ? "▾" : "▸"}</span>
        {k !== null && (
          <span className={matchesSearch ? "bg-accent-warn/30 text-ink" : "text-sky-200"}>
            {k}:
          </span>
        )}
        <PreviewValue value={value} />
      </button>
      {expanded && (
        <div>
          {children.map(({ k: ck, v }) => (
            <Node
              key={ck}
              k={ck}
              value={v}
              depth={depth + 1}
              maxDepth={maxDepth}
              status="unchanged"
              initiallyExpanded={depth < 1}
              search={search}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function JsonTreeView({ data, diffKeys, maxDepth = 6 }: JsonTreeViewProps) {
  const [search, setSearch] = useState("");
  const keys = useMemo(() => Object.keys(data), [data]);
  const diffSet = useMemo(() => {
    if (!diffKeys) return null;
    return {
      added: new Set(diffKeys.added),
      removed: new Set(diffKeys.removed),
      changed: new Set(diffKeys.changed),
    };
  }, [diffKeys]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-bg-panel px-2 py-1">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search keys…"
          className="flex-1 rounded border border-line bg-bg-subtle px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        {diffKeys && (
          <span className="font-mono text-[10px] text-ink-faint">
            +{diffKeys.added.length} ~{diffKeys.changed.length} -{diffKeys.removed.length}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px]">
        {keys.map((k) => {
          const v = data[k];
          const status = diffSet
            ? diffSet.added.has(k)
              ? "added"
              : diffSet.removed.has(k)
                ? "removed"
                : diffSet.changed.has(k)
                  ? "changed"
                  : "unchanged"
            : "unchanged";
          return (
            <Node
              key={k}
              k={k}
              value={v}
              depth={0}
              maxDepth={maxDepth}
              status={status}
              initiallyExpanded={false}
              search={search}
            />
          );
        })}
        {keys.length === 0 && (
          <div className="text-ink-faint">Empty object.</div>
        )}
      </div>
    </div>
  );
}

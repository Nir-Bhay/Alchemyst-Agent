"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface WindowedListProps {
  readonly rowCount: number;
  readonly rowHeight: number;
  readonly overscan?: number;
  readonly renderRow: (index: number) => React.ReactNode;
}

/**
 * Custom virtualised list. Renders only the rows in the visible window
 * (plus `overscan` rows on each side). The total scrollable height is
 * `rowCount * rowHeight`; we use absolute positioning to place each
 * rendered row at `index * rowHeight`.
 *
 * Why custom: the assignment bans AI chat libraries, and shipping our
 * own virtualiser is part of the spirit of the exercise. This is ~80
 * lines and works well up to ~10k rows.
 */
export function WindowedList({
  rowCount,
  rowHeight,
  overscan = 8,
  renderRow,
}: WindowedListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const ro = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(rowCount, startIndex + visibleCount);

  const totalHeight = rowCount * rowHeight;
  const items: React.ReactNode[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    items.push(
      <div
        key={i}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          transform: `translateY(${i * rowHeight}px)`,
        }}
      >
        {renderRow(i)}
      </div>,
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="relative h-full overflow-y-auto"
      data-testid="windowed-list"
    >
      <div style={{ position: "relative", height: totalHeight }}>{items}</div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { ToolCardRecord, StreamState } from "@/state/slices/streams";
import { useAppStore } from "@/state/store";
import { appendTextNoReflow, cx } from "@/lib/dom";
import { ToolCard } from "./ToolCard";

interface StreamBubbleProps {
  readonly streamId: string;
  readonly stream: StreamState;
  readonly index: number;
}

/**
 * Renders one stream's chat bubble. The trick: the text content is *not*
 * re-rendered on every token. Instead, the React state holds only the
 * *shape* (which tool cards exist, is the stream ended, etc.); the actual
 * text content is appended imperatively to a ref-held DOM Text node.
 *
 * On every store change for this stream's text, we compute the delta
 * against the last ref and call `appendTextNoReflow` — a single
 * `nodeValue += delta`. No React reconciliation, no virtual DOM diff for
 * the text content, no layout invalidation above the changed line.
 *
 * This is the only way to keep token streaming smooth at 30+ events/sec
 * while still benefiting from React for the structural updates (tool
 * cards, frozen state, end-of-stream seal).
 */
export function StreamBubble({ streamId, stream, index }: StreamBubbleProps) {
  const textNodeRef = useRef<HTMLSpanElement | null>(null);
  const textContentRef = useRef<Text | null>(null);
  const lastTextRef = useRef<string>(stream.text);
  const lastStreamIdRef = useRef<string>(streamId);

  // Initial render: ensure the text node exists with the current text.
  useEffect(() => {
    if (!textNodeRef.current) return;
    let node = textContentRef.current;
    if (!node) {
      // The <span> starts empty (we deliberately don't render `stream.text`
      // via JSX). Create a text node and append it to the span.
      node = document.createTextNode(stream.text);
      textNodeRef.current.appendChild(node);
      textContentRef.current = node;
    }
    lastTextRef.current = stream.text;
  }, []); // intentional: run once on mount

  // If the streamId ever changes (it shouldn't, but be defensive), reset.
  useEffect(() => {
    if (lastStreamIdRef.current !== streamId) {
      lastStreamIdRef.current = streamId;
      lastTextRef.current = "";
      const n = textContentRef.current;
      if (n) n.nodeValue = "";
    }
  }, [streamId]);

  // Imperative subscription: every time the store's text for this stream
  // changes, append the delta to the text node. This is the per-token
  // fast path. It does NOT cause a React re-render.
  useEffect(() => {
    return useAppStore.subscribe(
      (s) => s.streams.get(streamId)?.text,
      (currentText) => {
        if (currentText === undefined) return;
        if (currentText === lastTextRef.current) return;
        const node = textContentRef.current;
        if (!node) return;
        if (currentText.length < lastTextRef.current.length || !lastTextRef.current) {
          // Shorter or first time — full replace.
          node.nodeValue = currentText;
        } else {
          // Append only the new suffix. This is O(delta length) and
          // does not invalidate layout above the changed node.
          const delta = currentText.slice(lastTextRef.current.length);
          appendTextNoReflow(node, delta);
        }
        lastTextRef.current = currentText;
      },
      {
        // Only fire when the value actually changes. We do this in the
        // listener too but the equality fn saves a notify.
        equalityFn: (a, b) => a === b,
        fireImmediately: false,
      },
    );
  }, [streamId]);

  return (
    <div
      data-stream-id={streamId}
      data-stream-index={index}
      className={cx(
        "rounded-md border border-line bg-bg-panel px-4 py-3 shadow-sm",
        "animate-fade-in",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-dim">
        <span className="font-mono">{streamId}</span>
        {!stream.streamEnded && stream.toolCards.some((c) => c.awaitingResult) && (
          <span className="rounded bg-accent-tool/15 px-1.5 py-0.5 text-accent-tool">
            tool running
          </span>
        )}
        {stream.streamEnded && (
          <span className="rounded bg-accent-ok/15 px-1.5 py-0.5 text-accent-ok">ended</span>
        )}
        {stream.toolCards.some((c) => c.droppedWhileWaiting) && (
          <span className="rounded bg-accent-warn/15 px-1.5 py-0.5 text-accent-warn">
            waiting on result
          </span>
        )}
      </div>
      <div className="whitespace-pre-wrap leading-relaxed text-ink">
        {/* The text content is owned by an imperative subscription in
            the effect above. We do NOT render the text via JSX — if we
            did, React would overwrite the imperative nodeValue on every
            re-render. Instead the <span> is empty; the effect populates
            it on mount and on text changes. */}
        <span ref={textNodeRef} />
        {!stream.streamEnded && stream.toolCards.every((c) => !c.awaitingResult) && (
          <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse-dot bg-ink-dim align-middle" />
        )}
      </div>
      {stream.toolCards.length > 0 && (
        <div className="mt-3 space-y-2">
          {stream.toolCards.map((card) => (
            <ToolCardView key={card.call_id} card={card} streamId={streamId} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCardView({ card, streamId }: { card: ToolCardRecord; streamId: string }) {
  return <ToolCard card={card} streamId={streamId} />;
}

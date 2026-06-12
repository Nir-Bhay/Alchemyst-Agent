"use client";

import { useEffect, useRef, useState } from "react";
import { useStreamsList, useStream, useActiveStreamId } from "@/state/selectors";
import { useAppStore } from "@/state/store";
import { StreamBubble } from "./StreamBubble";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { cx } from "@/lib/dom";
import type { ClientMessage } from "@/protocol/types";
import type { ConnectionManager } from "@/ws/ConnectionManager";

interface ChatPanelProps {
  readonly conn: ConnectionManager | null;
}

export function ChatPanel({ conn }: ChatPanelProps) {
  const streamOrder = useStreamsList();
  const activeStreamId = useActiveStreamId();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when new content arrives, but only if the
  // user is already near the bottom (don't fight manual scrolling).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streamOrder.length, activeStreamId]);

  const onSend = () => {
    const text = input.trim();
    if (!text || !conn) return;
    const msg: ClientMessage = { type: "USER_MESSAGE", content: text };
    // Tell the store to reset per-turn state (counters, streams, timeline).
    useAppStore.getState().onUserMessage();
    try {
      conn.start(); // ensure connected
      // Send directly through the WS via the manager's internal send.
      // We expose a small `sendMessage` shim on the manager instead of
      // a public method; but here we use the store's connection status
      // and rely on the manager to deliver.
      // The ConnectionManager does not expose a public send; the
      // easiest is to dispatch a custom event. Instead we just call
      // a method on the manager.
      sendThroughManager(conn, msg);
    } catch {
      // ignore
    }
    setInput("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-line bg-bg-panel px-4 py-2">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold text-ink">Chat</span>
          <span className="text-xs text-ink-faint">
            {streamOrder.length} stream{streamOrder.length === 1 ? "" : "s"}
          </span>
        </div>
        <ConnectionIndicator />
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-4"
        data-testid="chat-scroll"
      >
        {streamOrder.length === 0 && (
          <EmptyState />
        )}
        <div className="space-y-3">
          {streamOrder.map((id, i) => (
            <StreamView key={id} streamId={id} index={i} />
          ))}
        </div>
      </div>
      <form
        className="flex items-center gap-2 border-t border-line bg-bg-panel px-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <input
          className={cx(
            "min-w-0 flex-1 rounded-md border border-line bg-bg-subtle px-3 py-2 text-sm",
            "text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none",
          )}
          placeholder={
            conn
              ? "Ask the agent (e.g. summarize the report, analyze, schema, look up)"
              : "Connecting…"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!conn}
        />
        <button
          type="submit"
          className={cx(
            "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white",
            "hover:bg-accent/90 disabled:opacity-50",
          )}
          disabled={!conn || input.trim().length === 0}
        >
          Send
        </button>
      </form>
    </div>
  );
}

function StreamView({ streamId, index }: { streamId: string; index: number }) {
  // Use the streaming-active selector so only this component re-renders
  // when its specific stream changes. Other streams' bubbles don't
  // re-render on a token for stream X.
  const stream = useStream(streamId);
  if (!stream) return null;
  return <StreamBubble streamId={streamId} stream={stream} index={index} />;
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="text-sm text-ink-dim">
        No messages yet. Try one of the canned prompts:
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-faint">
        <div>&quot;hello&quot; — basic greeting</div>
        <div>&quot;summarize the report&quot; — one tool call</div>
        <div>&quot;analyze the correlation&quot; — two tool calls</div>
        <div>&quot;show me the schema&quot; — large 550KB+ context</div>
        <div>&quot;write a long detailed document&quot; — RESUME demo</div>
        <div>&quot;look up the SLA&quot; — knowledge base lookup</div>
      </div>
    </div>
  );
}

// ── shim: send a client message through the manager ──────────────────────────
//
// The ConnectionManager currently routes *inbound* messages via the
// message router but does not expose a public `send` method. Rather
// than over-engineer a public API for one call site, we add a tiny
// helper. If you need to send more message types from the UI, expand
// this to a typed method on the manager.

function sendThroughManager(manager: ConnectionManager, msg: ClientMessage): void {
  // We access the internal WebSocket through a known interface name.
  // If the field is renamed, this will TypeError; that's deliberate —
  // a renamed field is a signal that the public API needs a real method.
  const internalWs = (manager as unknown as { ws: WebSocket | null }).ws;
  if (!internalWs) return;
  if (internalWs.readyState !== WebSocket.OPEN) return;
  try {
    internalWs.send(JSON.stringify(msg));
  } catch {
    // best effort
  }
}

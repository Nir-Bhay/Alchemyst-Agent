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

const CANNED_PROMPTS: ReadonlyArray<{ prompt: string; description: string }> = [
  { prompt: "hello", description: "basic greeting" },
  { prompt: "summarize the report", description: "one tool call" },
  { prompt: "analyze the correlation", description: "two tool calls" },
  { prompt: "show me the schema", description: "550KB+ context" },
  { prompt: "write a long detailed document", description: "RESUME demo" },
  { prompt: "look up the SLA", description: "knowledge base lookup" },
];

export function ChatPanel({ conn }: ChatPanelProps) {
  const streamOrder = useStreamsList();
  const activeStreamId = useActiveStreamId();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll when new content arrives, but only if the user is already
  // near the bottom. Fighting manual scrolling is a worse experience than
  // not auto-scrolling.
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
    useAppStore.getState().onUserMessage();
    conn.send(msg);
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
        {streamOrder.length === 0 && <EmptyState />}
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
        {CANNED_PROMPTS.map((p) => (
          <div key={p.prompt}>
            &quot;{p.prompt}&quot; — {p.description}
          </div>
        ))}
      </div>
    </div>
  );
}

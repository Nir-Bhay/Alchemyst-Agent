"use client";

import { useEffect, useRef } from "react";
import { ChatPanel } from "./ChatPanel";
import { TimelinePanel } from "./TimelinePanel";
import { ContextPanel } from "./ContextPanel";
import { FilterBar } from "./FilterBar";
import { ConnectionManager } from "@/ws/ConnectionManager";
import { getStore } from "@/state/store";

const WS_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_URL) ||
  "ws://localhost:4747/ws";

const HEALTH_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_HEALTH_URL) ||
  "http://localhost:4747/health";

export function Console() {
  const managerRef = useRef<ConnectionManager | null>(null);

  useEffect(() => {
    const manager = new ConnectionManager({
      url: WS_URL,
      onStateChange: () => {
        // The state lives in the store; we don't need to do anything here
        // beyond what the manager already pushes via the store.
      },
    });
    managerRef.current = manager;
    manager.start();

    // Light health poller: every 10s, fetch /health to detect the server
    // mode (normal vs chaos). Failures are silent.
    const poll = setInterval(async () => {
      try {
        const r = await fetch(HEALTH_URL, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { mode?: string };
        const mode = j.mode === "chaos" ? "chaos" : j.mode === "normal" ? "normal" : "unknown";
        getStore().setServerMode(mode);
      } catch {
        // silent
      }
    }, 10_000);

    return () => {
      clearInterval(poll);
      manager.stop();
      managerRef.current = null;
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col">
      <header className="flex items-center justify-between border-b border-line bg-bg-panel px-4 py-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-tight">Agent Console</h1>
          <span className="font-mono text-[11px] text-ink-faint">
            Alchemyst AI · Full Stack Engineer assignment
          </span>
        </div>
        <HeaderStats />
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[1fr_360px_360px]">
        <ChatPanel conn={managerRef.current} />
        <div className="flex min-h-0 flex-col">
          <FilterBar />
          <TimelinePanel />
        </div>
        <ContextPanel />
      </main>
    </div>
  );
}

function HeaderStats() {
  // Render a tiny connection status inline at the header level too.
  // (The richer pill is in the chat header.)
  return (
    <div className="flex items-center gap-3 text-[11px] text-ink-faint">
      <span className="font-mono">{WS_URL.replace(/^ws/, "ws")}</span>
    </div>
  );
}

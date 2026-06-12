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

const HEALTH_POLL_MS = 10_000;

export function Console() {
  const managerRef = useRef<ConnectionManager | null>(null);

  useEffect(() => {
    const manager = new ConnectionManager({
      url: WS_URL,
      onStateChange: () => {
        // State is owned by the store; the manager pushes transitions
        // there directly. This callback exists for future UI consumers
        // (e.g. a sound on reconnect); intentionally empty for now.
      },
    });
    managerRef.current = manager;
    manager.start();

    // The store reflects connection state in real time; the /health poll
    // exists only to surface the server's mode (normal vs chaos) in the
    // indicator pill. Failures are silent — chaos mode runs at /health
    // too, so a missing server just means "unknown mode".
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
    }, HEALTH_POLL_MS);

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

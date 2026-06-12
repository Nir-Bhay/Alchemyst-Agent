"use client";

import { useConnection, useCounters } from "@/state/selectors";
import { cx } from "@/lib/dom";

export function ConnectionIndicator() {
  const connection = useConnection();
  const counters = useCounters();
  const status = connection.status;
  const isReconnecting = status === "reconnecting" || status === "resuming";
  const isConnecting = status === "connecting";
  const isConnected = status === "connected" || status === "idle" || status === "streaming" || status === "tool_call_pending";

  const pill = (() => {
    if (isReconnecting) {
      return {
        label: connection.reconnectAttempts > 0
          ? `Reconnecting (attempt ${connection.reconnectAttempts})…`
          : "Reconnecting…",
        cls: "bg-accent-warn/15 text-accent-warn border-accent-warn/30",
        dot: "bg-accent-warn animate-pulse-dot",
      };
    }
    if (isConnecting) {
      return {
        label: "Connecting…",
        cls: "bg-accent/15 text-accent border-accent/30",
        dot: "bg-accent animate-pulse-dot",
      };
    }
    if (isConnected) {
      return {
        label: connection.serverMode === "chaos" ? "Connected (chaos)" : "Connected",
        cls: "bg-accent-ok/15 text-accent-ok border-accent-ok/30",
        dot: "bg-accent-ok",
      };
    }
    return {
      label: "Disconnected",
      cls: "bg-accent-err/15 text-accent-err border-accent-err/30",
      dot: "bg-accent-err",
    };
  })();

  return (
    <div className="flex items-center gap-3" data-testid="connection-indicator">
      <div
        className={cx(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
          pill.cls,
        )}
      >
        <span className={cx("h-2 w-2 rounded-full", pill.dot)} />
        {pill.label}
      </div>
      <div className="hidden font-mono text-xs text-ink-faint md:block" title="rendered / received seq">
        rendered {counters.highestRenderedSeq} · received {counters.highestReceivedSeq}
      </div>
    </div>
  );
}

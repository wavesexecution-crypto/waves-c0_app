"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the server for fresh RSC content.
 *
 * Skips ticks while the tab is hidden — a backgrounded tab previously kept
 * driving continuous server work, which on Vercel means needless function
 * invocations for a client who simply left the page open.
 */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);

  const tick = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (!on) return;
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [tick, on, intervalMs]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setOn((v) => !v)}
        className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
      >
        {on ? "Live · pause" : "Paused · resume"}
      </button>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
      >
        Refresh now
      </button>
      <span className="hidden text-[11px] text-muted-foreground sm:inline">
        Pauses while this tab is in the background
      </span>
    </div>
  );
}
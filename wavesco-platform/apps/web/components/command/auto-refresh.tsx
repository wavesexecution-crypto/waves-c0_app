"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Polls the server for fresh RSC content at a fixed interval. */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!on) {
      return;
    }
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [router, on, intervalMs]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setOn((v) => !v);
        }}
        className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
      >
        {on ? "Live · pause" : "Paused · resume"}
      </button>
      <button
        type="button"
        onClick={() => {
          router.refresh();
        }}
        className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
      >
        Refresh now
      </button>
    </div>
  );
}

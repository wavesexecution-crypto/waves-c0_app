"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Customer-safe retry: re-requests the current route, no technical detail. */
export function RetryButton({ label = "Retry" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        router.refresh();
        window.setTimeout(() => {
          setBusy(false);
        }, 4000);
      }}
      className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
    >
      {busy ? "Retrying…" : label}
    </button>
  );
}

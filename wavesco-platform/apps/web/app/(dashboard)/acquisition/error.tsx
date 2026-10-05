"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Error boundary for every Acquisition OS route. Without it a failed server
 *  query fell through to the generic Next.js error screen. */
export default function AcquisitionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Full detail stays server-side; the client only ever sees a reference id.
    console.error("[acquisition] view failed", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-lg border border-dashed border-red-500/40 p-8 text-center">
      <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">This view could not load</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        Something failed on our side, not on yours. Your campaigns, leads and reports are unaffected — retry, and if
        the problem persists contact Waves.
        {error.digest ? (
          <span className="block pt-1 font-mono text-[11px] text-muted-foreground/70">reference: {error.digest}</span>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => { reset(); }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
        <Link href="/acquisition" className="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-accent">
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
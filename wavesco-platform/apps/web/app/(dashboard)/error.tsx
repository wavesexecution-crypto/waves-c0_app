"use client";

import { useEffect } from "react";
import { Button } from "@wavesco/ui";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side diagnostics only; the client sees a clean message.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-lg border border-dashed border-red-500/40 p-8 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        This view could not be loaded. Your data is safe — retry, and if the
        problem persists contact WavesCo support
        {error.digest ? (
          <span className="block pt-1 font-mono text-[11px] text-muted-foreground/70">
            reference: {error.digest}
          </span>
        ) : null}
      </p>
      <Button size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}

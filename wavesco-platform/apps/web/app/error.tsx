"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Root-segment error boundary. `app/(dashboard)/error.tsx` cannot catch errors
 *  thrown by that segment's own layout, so without this file a single database
 *  blip replaced the entire app with Next's unstyled "Application error" page. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Full detail stays server-side; the client only ever sees a reference id.
    console.error("[app] unhandled error", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Something went wrong
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em]">
            We could not load this page
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Something failed on our side, not on yours. Your data is safe. Try again — if it keeps happening,
            contact Waves and quote the reference below.
          </p>
          {error.digest ? (
            <p className="mt-4 font-mono text-[11px] text-muted-foreground/70">Reference: {error.digest}</p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => { reset(); }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
            <Link
              href="/command"
              className="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
            >
              Command Center
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
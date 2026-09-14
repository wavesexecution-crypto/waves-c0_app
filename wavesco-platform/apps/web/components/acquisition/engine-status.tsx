import type { SafeEngineError } from "@/lib/wavesco/engine-errors";
import { RetryButton } from "./retry-button";

/**
 * Full customer-safe recovery card for an unavailable engine-backed section.
 * Renders ONLY the safe title/message + Retry. Raw detail never reaches JSX.
 */
export function EngineStatusCard({ error }: { error: SafeEngineError }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-border/60 bg-card p-8 text-center"
    >
      <p className="text-base font-semibold tracking-tight">{error.title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{error.message}</p>
      {error.retryable ? (
        <div className="mt-5">
          <RetryButton />
        </div>
      ) : null}
    </div>
  );
}

/** Compact one-line health indicator. Never exposes raw responses. */
export function EngineHealthPill({ ok }: { ok: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm" role="status">
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      <span className="text-muted-foreground">
        Lead research · {ok ? "Operational" : "Temporarily unavailable"}
      </span>
    </span>
  );
}

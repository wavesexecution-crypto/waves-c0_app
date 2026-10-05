import type { ReactNode } from "react";
import Link from "next/link";
import { formatIST } from "@/lib/wavesco/time";
import type { IntegrationState } from "@/lib/wavesco/integrations";

export function StatusPill({ state, label }: { state: string; label?: string }) {
  const text = label ?? state.replace(/_/g, " ");
  const isLive =
    state === "live" ||
    state === "connected" ||
    state === "healthy" ||
    state === "running" ||
    state === "active" ||
    state === "sent" ||
    state === "approved";
  const isQueued =
    state === "queued" ||
    state === "degraded" ||
    state === "scheduled" ||
    state === "submitted" ||
    state === "pending" ||
    state === "approved_for_approval" ||
    state === "awaiting_approval" ||
    state === "awaiting_approval_partial" ||
    state === "open" ||
    state === "replied";
  const isError =
    state === "disconnected" ||
    state === "failed" ||
    state === "error" ||
    state === "bounced" ||
    state === "rejected" ||
    state === "unsubscribed" ||
    state === "expired" ||
    state === "cancelled" ||
    state === "refunded";

  const dot = isLive
    ? "bg-emerald-500 shadow-[0_0_8px_hsl(142_76%_36%_/_0.5)]"
    : isQueued
      ? "bg-amber-500"
      : isError
        ? "bg-red-500"
        : "bg-zinc-500";

  return (
    <span className="inline-flex items-center gap-2" role="status" aria-label={`Status: ${text}`}>
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className={`absolute inline-flex h-2 w-2 rounded-full ${dot}`} />
        {isLive && (
          <span className="absolute inline-flex h-2 w-2 animate-[pulse-subtle_2s_ease-in-out_infinite] rounded-full bg-emerald-500 opacity-40" />
        )}
      </span>
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {text}
      </span>
    </span>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: number | string;
  detail?: string;
  href?: string;
}) {
  const inner = (
    <div className="group relative overflow-hidden rounded-lg border border-border/80 bg-card p-5 transition-colors duration-200 hover:border-border-strong hover:bg-card-hover">
      {/* Subtle top hairline for grid discipline */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent opacity-60" />
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 font-mono text-[26px] font-medium leading-none tracking-[-0.02em] text-foreground tabular-nums">
        {value}
      </p>
      {detail ? (
        <p className="mt-2 line-clamp-1 font-sans text-xs leading-5 text-muted-foreground/80">
          {detail}
        </p>
      ) : null}
    </div>
  );
  return href ? (
    // App Router navigation, not a full document reload — every KPI tile used
    // to throw away client state and re-run every server query on click.
    <Link
      href={href}
      className="block rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
    >
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    // Stacks on narrow screens: a long `right` slot (a timestamp, a counter)
    // previously squeezed the title to a few characters wide on a phone.
    <div className="flex flex-col items-start gap-2 border-b border-border/60 pb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1.5 max-w-3xl font-sans text-[13px] leading-5 text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function LastUpdated({ at }: { at: Date }) {
  return (
    <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground/70">
      Last updated: {formatIST(at)}
    </p>
  );
}

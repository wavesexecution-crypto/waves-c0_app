import type { ReactNode } from "react";
import { formatIST } from "@/lib/wavesco/time";
import type { IntegrationState } from "@/lib/wavesco/integrations";

export function StatusPill({ state }: { state: string }) {
  const styles: Record<string, string> = {
    connected: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    healthy: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    live: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    running: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
    queued: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    degraded: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    never_connected: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
    disconnected: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    failed: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    error: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    unavailable: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
  };
  const label = state.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${styles[state] ?? styles.unavailable}`}
      data-state={state as IntegrationState}
    >
      {label}
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
  const body = (
    <div className="rounded-lg border bg-card p-4 transition-colors hover:border-primary/40">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
  return href ? (
    <a href={href} className="block focus:outline-none">
      {body}
    </a>
  ) : (
    body
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
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
        {subtitle ? <p className="text-xs text-muted-foreground/70">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function LastUpdated({ at }: { at: Date }) {
  return <p className="text-[11px] text-muted-foreground">Last updated: {formatIST(at)}</p>;
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/command/primitives";
import { formatIST, relativeFrom } from "@/lib/wavesco/time";

interface OverviewResponse {
  corpus: { total: number; emailReady: number; contacted: number; replies?: number; byTier?: Record<string, number>; lastResearchedAt?: string | null };
  platform: { campaigns: number; queued: number; sent: number; failed?: number; followUpsPending?: number };
  system: {
    leadEngine: { status: string; detail: string };
    db: { status: string; detail: string };
    n8n: { status: string; detail: string };
  };
  facets?: { categories: string[]; cities: string[] };
  lastRun?: { started_at: string | null; finished_at: string | null; added?: number | null; telegram_status?: string | null } | null;
  recentActivity?: { id: string; title: string; type: string; createdAt: string; href?: string | null }[];
  alerts: unknown[];
}

function mapState(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === "ok" || normalized === "connected" || normalized === "live" || normalized === "healthy") return "live";
  if (normalized === "error" || normalized === "failed") return "error";
  if (normalized === "missing" || normalized === "disconnected") return "disconnected";
  if (normalized === "never_connected") return "never_connected";
  if (normalized === "degraded") return "degraded";
  return state;
}

export function OverviewLive() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let consecutiveFailures = 0;

    async function fetchOverview() {
      try {
        const res = await fetch("/api/acquisition/overview", { cache: "no-store" });
        if (!res.ok) {
          if (res.status === 401) {
            // Session expired: stop polling entirely. Leaving the interval
            // running meant a permanent "unauthorized" banner with no way back.
            if (interval) clearInterval(interval);
            interval = null;
            if (!cancelled) setUnauthorized(true);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as OverviewResponse;
        consecutiveFailures = 0;
        if (!cancelled) {
          setData(json);
          setError(null);
          setLastFetchAt(new Date());
        }
      } catch (e) {
        consecutiveFailures += 1;
        // Give up after repeated failures instead of polling indefinitely on a
        // route that will never answer.
        if (consecutiveFailures >= 3 && interval) {
          clearInterval(interval);
          interval = null;
        }
        if (!cancelled) setError("Live health is temporarily unavailable.");
      }
    }

    fetchOverview();
    interval = setInterval(fetchOverview, 30_000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  if (unauthorized) {
    return (
      <section className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Your session has expired</p>
        <p className="font-sans text-[13px] leading-5 text-muted-foreground">
          Sign in again to keep watching live activity. The figures above are from your last successful load.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Sign in again
        </Link>
      </section>
    );
  }

  if (error) {
    return (
      <section className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Live health unavailable</p>
        <p className="font-sans text-[13px] leading-5 text-muted-foreground">
          {error} The figures above are from your last successful load.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-border/80 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Try again
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="space-y-3">
        <p className="font-sans text-[13px] leading-5 text-muted-foreground">Loading live health…</p>
      </section>
    );
  }

  const { system, recentActivity, lastRun, corpus, platform } = data;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">Live System Health</h2>
          <span className="text-[11px] text-muted-foreground">{lastFetchAt ? `updated ${relativeFrom(lastFetchAt.toISOString())}` : ""} · polls every 30s</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-lg border border-border/80 bg-card p-3">
            <div>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Lead Engine</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{system.leadEngine.detail}</p>
            </div>
            <StatusPill state={mapState(system.leadEngine.status)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/80 bg-card p-3">
            <div>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Database</p>
              <p className="mt-1 text-xs text-muted-foreground">{system.db.detail}</p>
            </div>
            <StatusPill state={mapState(system.db.status)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/80 bg-card p-3">
            <div>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">n8n</p>
              <p className="mt-1 text-xs text-muted-foreground">{system.n8n.detail}</p>
            </div>
            <StatusPill state={mapState(system.n8n.status)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 text-xs text-muted-foreground">
          <span>Corpus live: {corpus.total} total · {corpus.emailReady} email-ready · {corpus.contacted} contacted</span>
          <span>Platform live: {platform.campaigns} campaigns · {platform.queued} queued · {platform.sent} sent</span>
          <span>{lastRun?.started_at ? `Last run ${formatIST(lastRun.started_at)}` : "No engine runs"}</span>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-sans text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">Recent Activity — Last 5</h2>
        {recentActivity && recentActivity.length > 0 ? (
          <ul className="divide-y rounded-lg border border-border/80 bg-card">
            {recentActivity.map((ev) => (
              <li key={ev.id} className="flex items-center justify-between px-4 py-2">
                <div>
                  <p className="font-sans text-[13px] font-medium tracking-[-0.01em]">{ev.title}</p>
                  <p className="text-[11px] text-muted-foreground">{ev.type} · {relativeFrom(ev.createdAt)}</p>
                </div>
                {ev.href ? <a href={ev.href} className="text-xs text-primary hover:underline">Open</a> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-border/80 border-dashed p-4 text-xs text-muted-foreground">No recent activity yet. Leads, campaigns and outreach will appear here.</p>
        )}
      </section>
    </div>
  );
}

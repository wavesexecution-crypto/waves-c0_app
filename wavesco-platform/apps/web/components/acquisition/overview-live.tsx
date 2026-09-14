"use client";

import { useEffect, useState } from "react";
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
  const [liveDown, setLiveDown] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function fetchOverview() {
      try {
        const res = await fetch("/api/acquisition/overview", { cache: "no-store" });
        if (!res.ok) throw new Error("overview unavailable");
        const json = (await res.json()) as OverviewResponse;
        if (!cancelled) {
          setData(json);
          setLiveDown(false);
          setLastFetchAt(new Date());
        }
      } catch {
        // Customer-safe: never render status codes or exception text.
        if (!cancelled) setLiveDown(true);
      }
    }

    void fetchOverview();
    interval = setInterval(() => {
      void fetchOverview();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (liveDown && !data) {
    return (
      <section className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
        <p className="text-xs font-medium">Live updates are paused</p>
        <p className="text-xs text-muted-foreground">Showing the latest saved state. Live updates will resume automatically.</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground">Loading live health…</p>
      </section>
    );
  }

  const { system, recentActivity, lastRun, corpus, platform } = data;

  // Labels derive from status only — the server sends safe words, but the
  // customer must never depend on arbitrary detail strings.
  const healthLabel = (status: string): string =>
    status === "ok" ? "Operational" : status === "missing" ? "Not configured" : "Temporarily unavailable";

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Live System Health</h2>
          <span className="text-[11px] text-muted-foreground">{lastFetchAt ? `updated ${relativeFrom(lastFetchAt.toISOString())}` : ""} · polls every 30s</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-lg border bg-card p-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lead research</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{healthLabel(system.leadEngine.status)}</p>
            </div>
            <StatusPill state={mapState(system.leadEngine.status)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-card p-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workspace</p>
              <p className="mt-1 text-xs text-muted-foreground">{healthLabel(system.db.status)}</p>
            </div>
            <StatusPill state={mapState(system.db.status)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-card p-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sending</p>
              <p className="mt-1 text-xs text-muted-foreground">{healthLabel(system.n8n.status)}</p>
            </div>
            <StatusPill state={mapState(system.n8n.status)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 text-xs text-muted-foreground">
          <span>Leads: {corpus.total} total · {corpus.emailReady} ready to contact · {corpus.contacted} contacted</span>
          <span>Outreach: {platform.campaigns} campaigns · {platform.queued} waiting · {platform.sent} sent</span>
          <span>{lastRun?.started_at ? `Last research ${formatIST(lastRun.started_at)}` : "No research runs yet"}</span>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Recent Activity — Last 5</h2>
        {recentActivity && recentActivity.length > 0 ? (
          <ul className="divide-y rounded-lg border bg-card">
            {recentActivity.map((ev) => (
              <li key={ev.id} className="flex items-center justify-between px-4 py-2">
                <div>
                  <p className="text-xs font-medium">{ev.title}</p>
                  <p className="text-[11px] text-muted-foreground">{ev.type} · {relativeFrom(ev.createdAt)}</p>
                </div>
                {ev.href ? <a href={ev.href} className="text-xs text-primary hover:underline">Open</a> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">No recent activity yet. Leads, campaigns and outreach will appear here.</p>
        )}
      </section>
    </div>
  );
}

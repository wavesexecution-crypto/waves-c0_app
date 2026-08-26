import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import {
  getCountsBy,
  getLeadStats,
  listBatchManifests,
} from "@/lib/wavesco/lead-engine";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics" };

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 shrink-0 truncate text-muted-foreground">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded bg-muted">
        <span
          className="block h-full rounded bg-primary/70"
          style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }}
        />
      </span>
      <span className="w-10 shrink-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

export default async function AnalyticsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  let stats: Awaited<ReturnType<typeof getLeadStats>> | null = null;
  let corpusError: string | null = null;
  try {
    stats = getLeadStats();
  } catch (e) {
    corpusError = e instanceof Error ? e.message : "Lead Engine unreachable";
  }

  const byTier = stats ? getCountsBy("tier") : {};
  const byCategory = stats ? getCountsBy("category") : {};
  const byCity = stats ? getCountsBy("city") : {};

  const platform = await withTenantContext(tenantId, async (tx) => ({
    campaigns: await tx.campaign.count({ where: { tenantId } }),
    emails: await tx.outreachEmail.count({ where: { tenantId } }),
    emailsSent: await tx.outreachEmail.count({ where: { tenantId, status: "sent" } }),
    followUps: await tx.followUp.count({ where: { tenantId } }),
    activity7d: await tx.activityEvent.count({
      where: { tenantId, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
    }),
  }));

  const manifests = (() => {
    try {
      return listBatchManifests().slice(0, 5);
    } catch {
      return [];
    }
  })();

  const tierMax = Math.max(1, ...Object.values(byTier));
  const catEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const cityEntries = Object.entries(byCity).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const catMax = Math.max(1, ...catEntries.map(([, v]) => v));
  const cityMax = Math.max(1, ...cityEntries.map(([, v]) => v));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Aggregates computed server-side at request time from the lead database and PostgreSQL. No sampling,
          no estimates.
        </p>
      </div>

      {!stats ? (
        <div className="rounded-lg border border-dashed border-red-500/40 p-6 text-sm">
          <p className="font-medium">Corpus analytics unavailable</p>
          <p className="text-muted-foreground">{corpusError}</p>
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Total leads", stats.total],
              ["Email ready", stats.emailReady],
              ["Contacted", stats.contacted],
              ["Replies", stats.replies],
            ].map(([l, v]) => (
              <div key={String(l)} className="rounded-lg border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{l}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-2 rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">By tier</h2>
              {Object.entries(byTier).map(([t, v]) => (
                <Bar key={t} label={`Tier ${t}`} value={v} max={tierMax} />
              ))}
            </div>
            <div className="space-y-2 rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Top categories</h2>
              {catEntries.map(([c, v]) => (
                <Bar key={c} label={c} value={v} max={catMax} />
              ))}
            </div>
            <div className="space-y-2 rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Top cities</h2>
              {cityEntries.map(([c, v]) => (
                <Bar key={c} label={c} value={v} max={cityMax} />
              ))}
            </div>
          </section>
        </>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Platform funnel</h2>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            ["Campaigns", platform.campaigns],
            ["Queued emails", platform.emails],
            ["Sent", platform.emailsSent],
            ["Follow-ups", platform.followUps],
            ["Activity (7d)", platform.activity7d],
          ].map(([l, v]) => (
            <div key={String(l)} className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{l}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
      </section>

      {manifests.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Recent batches</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {manifests.map((m) => (
              <li key={m.batchId} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-mono text-xs">{m.batchId}</span>
                <span className="text-xs text-muted-foreground">
                  {m.leadCount ?? "?"} leads · {formatIST(m.generatedAt ?? null)} · telegram{" "}
                  {m.telegramDeliveryStatus ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

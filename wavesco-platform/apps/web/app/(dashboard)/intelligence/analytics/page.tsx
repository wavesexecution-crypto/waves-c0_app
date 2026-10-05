import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getCountsBy, getLeadStats, listBatchManifests } from "@/lib/wavesco/lead-engine";
import { formatIST } from "@/lib/wavesco/time";
import { PageHeader, Section, Stat, StatGroup, Hairline, StatusDot } from "@/components/premium";
import { safeErrorText } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics" };

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-4 py-2">
      <span className="w-36 shrink-0 truncate text-sm text-foreground">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-10 shrink-0 text-right font-mono text-sm tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export default async function AnalyticsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  let stats: Awaited<ReturnType<typeof getLeadStats>> | null = null;
  let corpusError: string | null = null;
  try {
    stats = await getLeadStats();
  } catch (e) {
    corpusError = safeErrorText(e, "The lead database is temporarily unavailable. Metrics return automatically.", "leads:corpus");
  }

  const byTier = stats ? await getCountsBy("tier") : {};
  const byCategory = stats ? await getCountsBy("category") : {};
  const byCity = stats ? await getCountsBy("city") : {};

  const platform = await withTenantContext(tenantId, async (tx) => ({
    campaigns: await tx.campaign.count({ where: { tenantId } }),
    emails: await tx.outreachEmail.count({ where: { tenantId } }),
    emailsSent: await tx.outreachEmail.count({ where: { tenantId, status: "sent" } }),
    followUps: await tx.followUp.count({ where: { tenantId } }),
    activity7d: await tx.activityEvent.count({
      where: { tenantId, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
    }),
  }));

  const manifests = await (async () => {
    try {
      return (await listBatchManifests()).slice(0, 5);
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
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Intelligence"
        title="Analytics"
        description="A clear view of acquisition performance � where leads are, what''s ready, and what needs attention. Computed live from your lead database and workspace."
        actions={!corpusError ? <StatusDot state="live" label="Live" /> : <StatusDot state="alert" label="Corpus offline" />}
      />

      <div className="mx-auto max-w-[1280px] px-6 py-8 sm:px-8 lg:px-8">
        {!stats ? (
          <div className="border border-border/60 bg-card p-8">
            <p className="text-sm font-medium">Corpus analytics unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">{corpusError}</p>
          </div>
        ) : (
          <>
            <Section title="Overview" description="What''s in your lead system right now">
              <StatGroup>
                <Stat label="Total leads" value={stats.total} hint="Across all categories and cities" />
                <Stat label="Email ready" value={stats.emailReady} hint="Qualified for outreach" />
                <Stat label="Contacted" value={stats.contacted} hint="Outreach sent" />
                <Stat label="Replies" value={stats.replies} hint="Awaiting classification" />
              </StatGroup>
            </Section>

            <Hairline />

            <div className="grid gap-8 py-8 lg:grid-cols-3 lg:gap-12">
              <section>
                <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  By tier
                </h3>
                <div className="mt-4 divide-y divide-border/60 border-y border-border/60">
                  {Object.entries(byTier).map(([t, v]) => (
                    <BarRow key={t} label={`Tier ${t}`} value={v} max={tierMax} />
                  ))}
                </div>
                <p className="mt-3 font-mono text-xs text-muted-foreground">Tier reflects lead quality and enrichment.</p>
              </section>

              <section>
                <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Top categories
                </h3>
                <div className="mt-4 divide-y divide-border/60 border-y border-border/60">
                  {catEntries.map(([c, v]) => (
                    <BarRow key={c} label={c} value={v} max={catMax} />
                  ))}
                </div>
              </section>

              <section>
                <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Top cities
                </h3>
                <div className="mt-4 divide-y divide-border/60 border-y border-border/60">
                  {cityEntries.map(([c, v]) => (
                    <BarRow key={c} label={c} value={v} max={cityMax} />
                  ))}
                </div>
              </section>
            </div>

            <Hairline />

            <Section title="Funnel" description="Campaign to follow-up � where work is">
              <div className="grid gap-px bg-border/60">
                <div className="grid gap-px bg-border/60 sm:grid-cols-5">
                  {[
                    ["Campaigns", platform.campaigns],
                    ["Queued", platform.emails],
                    ["Sent", platform.emailsSent],
                    ["Follow-ups", platform.followUps],
                    ["Activity 7d", platform.activity7d],
                  ].map(([l, v]) => (
                    <div key={String(l)} className="bg-card p-6">
                      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{l}</p>
                      <p className="mt-2 text-[22px] font-semibold tracking-[-0.015em] text-foreground">{v as number}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Hairline />

            {manifests.length > 0 ? (
              <Section title="Recent batches" description="Latest Lead Engine runs � lead report and delivery">
                <div className="divide-y divide-border/60 border-y border-border/60">
                  {manifests.map((m) => (
                    <div key={m.batchId} className="flex flex-col gap-2 bg-card px-0 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-mono text-sm text-foreground">{m.batchId}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {m.leadCount ?? "?"} leads � {formatIST(m.generatedAt ?? null)} � telegram {m.telegramDeliveryStatus ?? "�"}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

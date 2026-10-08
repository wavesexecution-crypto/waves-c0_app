import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getFacets, selectCampaignCandidates } from "@/lib/wavesco/lead-engine";
import { CampaignCreateForm } from "@/components/acquisition/campaign-form";
import { CampaignSubmitPanel } from "@/components/acquisition/submit-panel";
import { CampaignControls } from "@/components/acquisition/campaign-controls";
import { StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { formatIST } from "@/lib/wavesco/time";
import { safeErrorText } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns" };

function statusPillState(status: string): string {
  const s = status.toLowerCase();
  if (s === "running" || s === "scheduled" || s === "sending") return "running";
  if (s === "paused") return "queued";
  if (s === "draft") return "never_connected";
  if (s === "stopped" || s === "completed" || s === "sent") return "disconnected";
  if (s === "failed") return "failed";
  return s;
}

async function campaignMetrics(tenantId: string, campaignId: string) {
  return withTenantContext(tenantId, async (tx: any) => {
    const [queued, sent, failed, total] = await Promise.all([
      tx.outreachEmail.count({ where: { tenantId, campaignId } }),
      tx.outreachEmail.count({ where: { tenantId, campaignId, status: "sent" } }),
      tx.outreachEmail.count({ where: { tenantId, campaignId, status: "failed" } }),
      tx.outreachEmail.count({ where: { tenantId, campaignId } }),
    ]);
    return { queued, sent, failed, total };
  });
}

async function CampaignCard({
  campaign: c,
  eligibleNow,
  tenantId,
}: {
  campaign: Awaited<ReturnType<typeof loadCampaigns>>[number];
  eligibleNow: number;
  tenantId: string;
}) {
  const metrics = await campaignMetrics(tenantId, c.id);
  const snapshot = c.eligibleSnapshot as Record<string, unknown> | null | undefined;
  const sentRate = metrics.total > 0 ? Math.round((metrics.sent / metrics.total) * 100) : 0;
  const failedRate = metrics.total > 0 ? Math.round((metrics.failed / metrics.total) * 100) : 0;

  return (
    <div className="rounded-lg border border-border/80 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/acquisition/campaigns/${c.id}`} className="font-sans text-[13px] font-medium leading-5 text-foreground hover:underline">
            {c.name}
          </Link>
          <p className="mt-0.5 font-mono text-[11px] leading-5 tracking-[0.02em] text-muted-foreground">
            {[c.location ?? "all locations", c.category ?? "all categories", c.tier ? `tier ${c.tier}` : "all tiers"].join(" · ")}
            {" · created "}
            {formatIST(c.createdAt)}
          </p>
        </div>
        <StatusPill state={statusPillState(c.status)} />
      </div>

      {/* Monitor: eligibleSnapshot, sendingLimit, eligibleNow, queued */}
      <div className="mt-3 grid gap-2 rounded-lg border border-border/80 bg-muted/20 p-3 sm:grid-cols-3">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Monitor</p>
          <p className="mt-1 font-sans text-[13px] leading-5 text-foreground">
            Eligible now: <strong className={`font-mono tabular-nums ${eligibleNow > 0 ? "text-foreground" : "opacity-60"}`}>{eligibleNow < 0 ? "engine unavailable" : eligibleNow}</strong>
          </p>
          <p className="font-mono text-[11px] leading-5 tracking-[0.02em] text-muted-foreground">Queued emails: {metrics.queued ?? metrics.total}</p>
          <p className="font-mono text-[11px] leading-5 tracking-[0.02em] text-muted-foreground">Sending limit: {c.sendingLimit ?? "no cap"}</p>
          {snapshot ? (
            <p className="mt-1 truncate font-mono text-[11px] tracking-[0.02em] text-muted-foreground" title={JSON.stringify(snapshot)}>
              Snapshot: {JSON.stringify(snapshot).slice(0, 120)}
              {JSON.stringify(snapshot).length > 120 ? "…" : ""}
            </p>
          ) : (
            <p className="font-mono text-[11px] leading-5 tracking-[0.02em] text-muted-foreground/60">No eligibleSnapshot yet</p>
          )}
        </div>
        {/* Analyze: sent/failed rate */}
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Analyze</p>
          <p className="mt-1 font-sans text-[13px] leading-5 text-foreground">
            Sent: <strong className="font-mono tabular-nums">{metrics.sent}</strong> · Failed: <strong className="font-mono tabular-nums">{metrics.failed}</strong> · Total: <span className="font-mono tabular-nums">{metrics.total}</span>
          </p>
          {metrics.total > 0 ? (
            <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
              Sent {sentRate}% · Failed {failedRate}%
            </p>
          ) : (
            <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground/60">No sends yet</p>
          )}
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-emerald-500" style={{ width: `${sentRate}%` }} />
          </div>
        </div>
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">State</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Status: <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-foreground">{c.status}</span>
          </p>
          {c.scheduledFor ? <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Scheduled: {formatIST(c.scheduledFor)}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Link href={`/acquisition/campaigns/${c.id}`} className="rounded-lg border border-border/80 px-2.5 py-1 font-sans text-[13px] text-foreground hover:bg-muted/50">
              Inspect
            </Link>
            <Link href={`/acquisition/campaigns/${c.id}`} className="rounded-lg border border-border/80 px-2.5 py-1 font-sans text-[13px] text-foreground hover:bg-muted/50">
              Configure
            </Link>
            <Link href={`/acquisition/campaigns?from=${encodeURIComponent(c.id)}#new-campaign`} className="rounded-lg border border-border/80 px-2.5 py-1 font-sans text-[13px] text-foreground hover:bg-muted/50">
              Run again
            </Link>
          </div>
        </div>
      </div>

      {/* Controls: Launch/Pause/Resume/Stop with confirm dialogs (client) */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <CampaignControls campaignId={c.id} status={c.status} campaignName={c.name} />
        <Link href={`/acquisition/campaigns/${c.id}`} className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground hover:text-foreground hover:underline">
          Open detail →
        </Link>
      </div>

      {metrics.queued === 0 && c.status === "draft" ? (
        <div className="mt-3">
          <CampaignSubmitPanel campaignId={c.id} campaignName={c.name} eligible={Math.max(eligibleNow, 0)} />
        </div>
      ) : null}
    </div>
  );
}

async function loadCampaigns(tenantId: string) {
  return withTenantContext(tenantId, (tx: any) =>
    tx.campaign.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 25 })
  );
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const sp = await searchParams;

  let facets: Awaited<ReturnType<typeof getFacets>> | null = null;
  let engineError: string | null = null;
  try {
    facets = await getFacets();
  } catch (e) {
    engineError = safeErrorText(e, "The lead database is temporarily unavailable. Metrics return automatically.", "leads:corpus");
  }

  const campaigns = await loadCampaigns(tenantId);

  // "Run again" prefill: copy the previous campaign's audience into the form.
  // The form only applies values that still exist — stale ones fall back to "all".
  const fromId = typeof sp.from === "string" ? sp.from : null;
  const prefillSource = fromId ? campaigns.find((c: any) => c.id === fromId) ?? null : null;
  const prefill = prefillSource
    ? {
        name: `Copy of ${(prefillSource as any).name ?? "campaign"}`.slice(0, 80),
        location: (prefillSource as any).location ?? undefined,
        category: (prefillSource as any).category ?? undefined,
        tier: (prefillSource as any).tier ?? undefined,
      }
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">Campaigns</h1>
          <p className="mt-1 max-w-3xl font-sans text-[13px] leading-5 text-muted-foreground">
            Choose who to reach. WAVES checks who&apos;s eligible, then every email waits for your approval before sending.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={10_000} />
          <Link href="#new-campaign" className="rounded-lg bg-primary px-3 py-1.5 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
            + Create
          </Link>
          <Link href="/acquisition/outreach" className="rounded-lg border border-border/80 bg-card px-3 py-1.5 font-sans text-[13px] text-foreground hover:bg-muted/50">
            Outreach
          </Link>
        </div>
      </div>

      {/* Control bar summary */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-card p-3">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Control:</span>
        <span className="rounded-full border border-border/80 px-2 py-0.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Create → forms a draft</span>
        <span className="rounded-full border border-border/80 px-2 py-0.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Configure → detail</span>
        <span className="rounded-full border border-border/80 px-2 py-0.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Launch / Pause / Resume / Stop</span>
        <span className="rounded-full border border-border/80 px-2 py-0.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Inspect → detail + monitor</span>
        <span className="rounded-full border border-border/80 px-2 py-0.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Analyze → sent/failed rate</span>
        <span className="ml-auto font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{campaigns.length} campaigns · state reflects DB + audit</span>
      </div>

      <section id="new-campaign" className="space-y-3">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">New campaign</h2>
        {prefillSource ? (
          <p className="font-sans text-[13px] leading-5 text-muted-foreground">
            Prefilled from “{(prefillSource as any).name}” — adjust anything and create. Eligibility is checked live before anything can be queued.
          </p>
        ) : null}
        {engineError || !facets ? (
          <div className="rounded-lg border border-dashed border-red-500/30 bg-card p-4">
            <p className="font-sans text-[13px] font-medium text-foreground">Cannot build segments — Lead Engine unavailable</p>
            <p className="mt-1 font-mono text-[11px] leading-5 tracking-[0.02em] text-muted-foreground">{engineError}</p>
            <a href="/acquisition/campaigns" className="mt-2 inline-flex rounded-lg border border-border/80 bg-card px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] hover:bg-muted/50">
              Retry
            </a>
          </div>
        ) : (
          <CampaignCreateForm cities={facets.cities} categories={facets.categories} initial={prefill} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Campaigns</h2>
        {campaigns.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/80 bg-card p-8 text-center">
            <p className="font-sans text-[13px] text-muted-foreground">No campaigns yet. Create one above — eligibility is verified before anything can be queued.</p>
            <Link href="#new-campaign" className="mt-3 inline-flex rounded-lg bg-primary px-3 py-1.5 font-sans text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
              Create First Campaign
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {await Promise.all(
              campaigns.map(async (c: any) => {
                let eligibleNow = 0;
                try {
                  const candidates = await selectCampaignCandidates({
                    location: c.location ?? undefined,
                    category: c.category ?? undefined,
                    tier: c.tier ?? undefined,
                  });
                  eligibleNow = candidates.filter((x) => x.email !== null && x.emailVerified && !x.contacted && !x.optedOut && !x.bounced).length;
                } catch {
                  eligibleNow = -1;
                }
                return <CampaignCard key={c.id} campaign={c} eligibleNow={eligibleNow} tenantId={tenantId} />;
              })
            )}
          </div>
        )}
      </section>
    </div>
  );
}

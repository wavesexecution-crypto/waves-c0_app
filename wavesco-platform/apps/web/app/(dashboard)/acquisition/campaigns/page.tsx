import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getFacets, selectCampaignCandidates } from "@/lib/wavesco/lead-engine";
import { logEngineError, toSafeEngineError } from "@/lib/wavesco/engine-errors";
import { EngineStatusCard } from "@/components/acquisition/engine-status";
import { CampaignCreateForm } from "@/components/acquisition/campaign-form";
import { CampaignSubmitPanel } from "@/components/acquisition/submit-panel";
import { CampaignControls } from "@/components/acquisition/campaign-controls";
import { StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { formatIST } from "@/lib/wavesco/time";

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
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/acquisition/campaigns/${c.id}`} className="font-medium hover:underline">
            {c.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {[c.location ?? "all locations", c.category ?? "all categories", c.tier ? `tier ${c.tier}` : "all tiers"].join(" · ")}
            {" · created "}
            {formatIST(c.createdAt)}
          </p>
        </div>
        <StatusPill state={statusPillState(c.status)} />
      </div>

      {/* Monitor: eligibleSnapshot, sendingLimit, eligibleNow, queued */}
      <div className="mt-3 grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Monitor</p>
          <p className="mt-1 text-xs">
            Eligible now: <strong className={eligibleNow > 0 ? "text-foreground" : "opacity-60"}>{eligibleNow < 0 ? "engine unavailable" : eligibleNow}</strong>
          </p>
          <p className="text-xs text-muted-foreground">Queued emails: {metrics.queued ?? metrics.total}</p>
          <p className="text-xs text-muted-foreground">Sending limit: {c.sendingLimit ?? "no cap"}</p>
          {snapshot ? (
            <p className="mt-1 truncate text-[11px] text-muted-foreground" title={JSON.stringify(snapshot)}>
              Snapshot: {JSON.stringify(snapshot).slice(0, 120)}
              {JSON.stringify(snapshot).length > 120 ? "…" : ""}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground/60">No eligibleSnapshot yet</p>
          )}
        </div>
        {/* Analyze: sent/failed rate */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Analyze</p>
          <p className="mt-1 text-xs">
            Sent: <strong className="tabular-nums">{metrics.sent}</strong> · Failed: <strong className="tabular-nums">{metrics.failed}</strong> · Total: {metrics.total}
          </p>
          {metrics.total > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Sent {sentRate}% · Failed {failedRate}%
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground/60">No sends yet</p>
          )}
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-emerald-500" style={{ width: `${sentRate}%` }} />
          </div>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">State</p>
          <p className="mt-1 text-xs">
            Status: <span className="font-mono text-xs uppercase">{c.status}</span>
          </p>
          {c.scheduledFor ? <p className="text-[11px] text-muted-foreground">Scheduled: {formatIST(c.scheduledFor)}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Link href={`/acquisition/campaigns/${c.id}`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
              Inspect
            </Link>
            <Link href={`/acquisition/campaigns/${c.id}`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
              Configure
            </Link>
          </div>
        </div>
      </div>

      {/* Controls: Launch/Pause/Resume/Stop with confirm dialogs (client) */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <CampaignControls campaignId={c.id} status={c.status} campaignName={c.name} />
        <Link href={`/acquisition/campaigns/${c.id}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
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

export default async function CampaignsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  let facets: Awaited<ReturnType<typeof getFacets>> | null = null;
  let engineFailure: unknown = null;
  try {
    facets = await getFacets();
  } catch (e) {
    logEngineError("campaigns:facets", e);
    engineFailure = e;
  }

  const campaigns = await loadCampaigns(tenantId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Segments are counted against the live lead corpus. Sends go through the existing Approval Queue — the
            platform never sends email itself.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={10_000} />
          <Link href="#new-campaign" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            + Create
          </Link>
          <Link href="/acquisition/outreach" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Outreach
          </Link>
        </div>
      </div>

      {/* Control bar summary */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-xs">
        <span className="font-medium uppercase tracking-widest text-muted-foreground">Control:</span>
        <span className="rounded-full border px-2 py-0.5">Create → forms a draft</span>
        <span className="rounded-full border px-2 py-0.5">Configure → detail</span>
        <span className="rounded-full border px-2 py-0.5">Launch / Pause / Resume / Stop</span>
        <span className="rounded-full border px-2 py-0.5">Inspect → detail + monitor</span>
        <span className="rounded-full border px-2 py-0.5">Analyze → sent/failed rate</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{campaigns.length} campaigns · state reflects DB + audit</span>
      </div>

      <section id="new-campaign" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">New campaign</h2>
        {engineFailure || !facets ? (
          <EngineStatusCard error={toSafeEngineError(engineFailure)} />
        ) : (
          <CampaignCreateForm cities={facets.cities} categories={facets.categories} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Campaigns</h2>
        {campaigns.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            <p>No campaigns yet. Create one above — eligibility is verified before anything can be queued.</p>
            <Link href="#new-campaign" className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
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

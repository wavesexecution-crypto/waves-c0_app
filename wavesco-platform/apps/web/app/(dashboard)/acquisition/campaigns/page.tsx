import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getFacets, selectCampaignCandidates } from "@/lib/wavesco/lead-engine";
import { CampaignCreateForm } from "@/components/acquisition/campaign-form";
import { CampaignSubmitPanel } from "@/components/acquisition/submit-panel";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns" };

async function queuedCount(tenantId: string, campaignId: string): Promise<number> {
  return withTenantContext(tenantId, (tx) =>
    tx.outreachEmail.count({ where: { tenantId, campaignId } }),
  );
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
  const queued = await queuedCount(tenantId, c.id);
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{c.name}</p>
          <p className="text-xs text-muted-foreground">
            {[c.location ?? "all locations", c.category ?? "all categories", c.tier ? `tier ${c.tier}` : "all tiers"].join(" · ")}
            {" · created "}
            {formatIST(c.createdAt)}
          </p>
        </div>
        <span className="rounded-full border px-2 py-0.5 text-[11px] uppercase text-muted-foreground">{c.status}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Eligible now: <strong className={eligibleNow > 0 ? "" : "opacity-60"}>{eligibleNow < 0 ? "engine unavailable" : eligibleNow}</strong> · queued emails: {queued}
        {c.sendingLimit ? ` · limit ${c.sendingLimit}` : ""}
      </p>
      {queued === 0 && c.status === "draft" ? (
        <div className="mt-3">
          <CampaignSubmitPanel campaignId={c.id} campaignName={c.name} eligible={Math.max(eligibleNow, 0)} />
        </div>
      ) : null}
    </div>
  );
}

async function loadCampaigns(tenantId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx.campaign.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 25 }),
  );
}

export default async function CampaignsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  let facets: Awaited<ReturnType<typeof getFacets>> | null = null;
  let engineError: string | null = null;
  try {
    facets = getFacets();
  } catch (e) {
    engineError = e instanceof Error ? e.message : "Lead Engine unreachable";
  }

  const campaigns = await loadCampaigns(tenantId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-muted-foreground">
          Segments are counted against the live lead corpus. Sends go through the existing Approval
          Queue — the platform never sends email itself.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">New campaign</h2>
        {engineError || !facets ? (
          <div className="rounded-lg border border-dashed border-red-500/40 p-4 text-sm">
            <p className="font-medium">Cannot build segments — Lead Engine unavailable</p>
            <p className="text-xs text-muted-foreground">{engineError}</p>
          </div>
        ) : (
          <CampaignCreateForm cities={facets.cities} categories={facets.categories} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Campaigns</h2>
        {campaigns.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No campaigns yet. Create one above — eligibility is verified before anything can be queued.
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => {
              // Recompute eligibility NOW from real data for honest numbers
              let eligibleNow = 0;
              try {
                const candidates = selectCampaignCandidates({
                  location: c.location ?? undefined,
                  category: c.category ?? undefined,
                  tier: c.tier ?? undefined,
                });
                eligibleNow = candidates.filter(
                  (x) => x.email !== null && x.emailVerified && !x.contacted && !x.optedOut && !x.bounced,
                ).length;
              } catch {
                eligibleNow = -1;
              }

              return (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  eligibleNow={eligibleNow}
                  tenantId={tenantId}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

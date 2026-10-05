import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { selectCampaignCandidates } from "@/lib/wavesco/lead-engine";
import { StatusPill } from "@/components/command/primitives";
import { CampaignControls } from "@/components/acquisition/campaign-controls";
import { AutoRefresh } from "@/components/command/auto-refresh";
import { formatIST } from "@/lib/wavesco/time";

export const dynamic = "force-dynamic";

function pillState(status: string): string {
  const s = status.toLowerCase();
  if (s === "running" || s === "scheduled" || s === "sending") return "running";
  if (s === "paused") return "queued";
  if (s === "draft") return "never_connected";
  if (s === "stopped" || s === "completed" || s === "sent") return "disconnected";
  if (s === "failed") return "failed";
  return s;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Campaign · ${id.slice(0, 8)}` };
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const { id } = await params;

  const campaign = await withTenantContext(tenantId, async (tx: any) =>
    tx.campaign.findFirst({ where: { id, tenantId } })
  );
  if (!campaign) notFound();

  const eligibleNow = await (async () => {
    try {
      const candidates = await selectCampaignCandidates({
        location: campaign.location ?? undefined,
        category: campaign.category ?? undefined,
        tier: campaign.tier ?? undefined,
      });
      return candidates.filter((x) => x.email !== null && x.emailVerified && !x.contacted && !x.optedOut && !x.bounced).length;
    } catch {
      return -1;
    }
  })();

  const metrics = await withTenantContext(tenantId, async (tx: any) => {
    const [total, sent, failed, queued] = await Promise.all([
      tx.outreachEmail.count({ where: { tenantId, campaignId: campaign.id } }),
      tx.outreachEmail.count({ where: { tenantId, campaignId: campaign.id, status: "sent" } }),
      tx.outreachEmail.count({ where: { tenantId, campaignId: campaign.id, status: "failed" } }),
      tx.outreachEmail.count({ where: { tenantId, campaignId: campaign.id, status: { in: ["submitted", "approved"] } } }),
    ]);
    const emails = await tx.outreachEmail.findMany({
      where: { tenantId, campaignId: campaign.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return { total, sent, failed, queued, emails: emails as any[] };
  });

  const snapshot = campaign.eligibleSnapshot as Record<string, unknown> | null | undefined;
  const sentRate = metrics.total > 0 ? Math.round((metrics.sent / metrics.total) * 100) : 0;
  const failedRate = metrics.total > 0 ? Math.round((metrics.failed / metrics.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/acquisition/campaigns" className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground hover:underline">
            ← Campaigns
          </Link>
          <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">{campaign.name}</h1>
          <p className="mt-1 font-mono text-[11px] leading-5 tracking-[0.02em] text-muted-foreground">
            {[campaign.location ?? "all locations", campaign.category ?? "all categories", campaign.tier ? `tier ${campaign.tier}` : "all tiers"].join(" · ")}
          </p>
          <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Created {formatIST(campaign.createdAt)} · ID <span className="tabular-nums">{campaign.id}</span></p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <AutoRefresh intervalMs={5_000} />
          <StatusPill state={pillState(campaign.status)} />
          <span className="rounded-full border border-border/80 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{campaign.status === "running" ? "● running" : campaign.status}</span>
        </div>
      </div>

      {/* State machine visual */}
      <div className="rounded-lg border border-border/80 bg-card p-4">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">State machine</h2>
        <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
          draft → <strong className="font-medium text-foreground">launch</strong> → scheduled → running ↔ paused → <strong className="font-medium text-foreground">stop</strong> → stopped
        </p>
        <div className="mt-3">
          <CampaignControls campaignId={campaign.id} status={campaign.status} campaignName={campaign.name} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-border/80 px-2 py-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Configure: edit via DB or recreate</span>
          <Link href="#monitor" className="rounded-full border border-border/80 px-2 py-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground hover:bg-muted/50 hover:text-foreground">
            Monitor
          </Link>
          <Link href="#analyze" className="rounded-full border border-border/80 px-2 py-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground hover:bg-muted/50 hover:text-foreground">
            Analyze
          </Link>
        </div>
      </div>

      {/* Monitor */}
      <section id="monitor" className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border/80 bg-card p-4">
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Monitor</h2>
          <div className="mt-3 space-y-2">
            <div className="flex justify-between border-b border-border/60 py-1.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Eligible now (live corpus)</span>
              <strong className="font-mono text-[11px] tabular-nums tracking-[0.02em] text-foreground">{eligibleNow < 0 ? "engine unavailable" : eligibleNow}</strong>
            </div>
            <div className="flex justify-between border-b border-border/60 py-1.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Sending limit</span>
              <span className="font-mono text-[11px] tabular-nums tracking-[0.02em] text-foreground">{campaign.sendingLimit ?? "no cap"}</span>
            </div>
            <div className="flex justify-between border-b border-border/60 py-1.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Queued</span>
              <span className="font-mono text-[11px] tabular-nums tracking-[0.02em] text-foreground">{metrics.queued}</span>
            </div>
            <div className="flex justify-between border-b border-border/60 py-1.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Scheduled for</span>
              <span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{campaign.scheduledFor ? formatIST(campaign.scheduledFor) : "—"}</span>
            </div>
            <div className="pt-2">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">eligibleSnapshot (captured at queue time)</p>
              {snapshot ? (
                <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-border/80 bg-muted/20 p-2 font-mono text-[11px] leading-5 tracking-[0.02em] text-muted-foreground">{JSON.stringify(snapshot, null, 2)}</pre>
              ) : (
                <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">No snapshot — campaign has not been queued yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Analyze */}
        <div id="analyze" className="rounded-lg border border-border/80 bg-card p-4">
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Analyze</h2>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-border/80 p-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Sent</p>
              <p className="mt-1 font-mono text-[20px] font-medium tabular-nums tracking-[-0.02em] text-foreground">{metrics.sent}</p>
              <p className="font-mono text-[11px] tabular-nums tracking-[0.02em] text-muted-foreground">{sentRate}%</p>
            </div>
            <div className="rounded-lg border border-border/80 p-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Failed</p>
              <p className="mt-1 font-mono text-[20px] font-medium tabular-nums tracking-[-0.02em] text-foreground">{metrics.failed}</p>
              <p className="font-mono text-[11px] tabular-nums tracking-[0.02em] text-muted-foreground">{failedRate}%</p>
            </div>
            <div className="rounded-lg border border-border/80 p-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Total</p>
              <p className="mt-1 font-mono text-[20px] font-medium tabular-nums tracking-[-0.02em] text-foreground">{metrics.total}</p>
              <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">queued + sent + failed</p>
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-emerald-500" style={{ width: `${sentRate}%` }} />
          </div>
          <p className="mt-2 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Sent rate vs failed rate across this campaign&apos;s outreach emails.</p>
        </div>
      </section>

      {/* Recent outreach emails */}
      <section className="rounded-lg border border-border/80 bg-card p-4">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Outreach emails (campaign)</h2>
        {metrics.emails.length === 0 ? (
          <p className="py-6 text-center font-sans text-[13px] text-muted-foreground">No outreach emails for this campaign yet. Use the submit panel on the list page or launch to queue.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border/80">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60 text-left font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Business</th>
                  <th className="px-3 py-2 font-medium">Recipient</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Sent at</th>
                </tr>
              </thead>
              <tbody>
                {metrics.emails.map((e: any) => (
                  <tr key={e.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 font-sans text-[13px] text-foreground">{e.business}</td>
                    <td className="px-3 py-2 font-mono text-[11px] tracking-[-0.01em] text-foreground">{e.email}</td>
                    <td className="px-3 py-2">
                      <StatusPill state={e.status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{e.sentAt ? formatIST(e.sentAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex gap-2">
        <Link href="/acquisition/campaigns" className="rounded-lg border border-border/80 bg-card px-3 py-1.5 font-sans text-[13px] text-foreground hover:bg-muted/50">
          Back to campaigns
        </Link>
        <Link href="/acquisition/outreach" className="rounded-lg border border-border/80 bg-card px-3 py-1.5 font-sans text-[13px] text-foreground hover:bg-muted/50">
          Outreach pipeline
        </Link>
      </div>
    </div>
  );
}

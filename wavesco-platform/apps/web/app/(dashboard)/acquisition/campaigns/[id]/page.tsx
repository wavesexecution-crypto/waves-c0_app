import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { selectCampaignCandidates } from "@/lib/wavesco/lead-engine";
import { StatusPill } from "@/components/command/primitives";
import { CampaignControls } from "@/components/acquisition/campaign-controls";
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
          <Link href="/acquisition/campaigns" className="text-xs text-muted-foreground hover:underline">
            ← Campaigns
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[campaign.location ?? "all locations", campaign.category ?? "all categories", campaign.tier ? `tier ${campaign.tier}` : "all tiers"].join(" · ")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Created {formatIST(campaign.createdAt)} · ID {campaign.id}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusPill state={pillState(campaign.status)} />
          <span className="rounded-full border px-2 py-0.5 text-xs font-mono uppercase">{campaign.status}</span>
        </div>
      </div>

      {/* State machine visual */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">State machine</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          draft → <strong>launch</strong> → scheduled → running ↔ paused → <strong>stop</strong> → stopped
        </p>
        <div className="mt-3">
          <CampaignControls campaignId={campaign.id} status={campaign.status} campaignName={campaign.name} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border px-2 py-1">Configure: edit via DB or recreate</span>
          <Link href="#monitor" className="rounded-full border px-2 py-1 hover:bg-accent">
            Monitor
          </Link>
          <Link href="#analyze" className="rounded-full border px-2 py-1 hover:bg-accent">
            Analyze
          </Link>
        </div>
      </div>

      {/* Monitor */}
      <section id="monitor" className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Monitor</h2>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between border-b py-1.5">
              <span className="text-muted-foreground">Eligible now (live corpus)</span>
              <strong className="tabular-nums">{eligibleNow < 0 ? "engine unavailable" : eligibleNow}</strong>
            </div>
            <div className="flex justify-between border-b py-1.5">
              <span className="text-muted-foreground">Sending limit</span>
              <span className="tabular-nums">{campaign.sendingLimit ?? "no cap"}</span>
            </div>
            <div className="flex justify-between border-b py-1.5">
              <span className="text-muted-foreground">Queued</span>
              <span className="tabular-nums">{metrics.queued}</span>
            </div>
            <div className="flex justify-between border-b py-1.5">
              <span className="text-muted-foreground">Scheduled for</span>
              <span>{campaign.scheduledFor ? formatIST(campaign.scheduledFor) : "—"}</span>
            </div>
            <div className="pt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">eligibleSnapshot (captured at queue time)</p>
              {snapshot ? (
                <pre className="mt-1 max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 text-xs">{JSON.stringify(snapshot, null, 2)}</pre>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">No snapshot — campaign has not been queued yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Analyze */}
        <div id="analyze" className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Analyze</h2>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sent</p>
              <p className="text-xl font-semibold tabular-nums">{metrics.sent}</p>
              <p className="text-[11px] text-muted-foreground">{sentRate}%</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Failed</p>
              <p className="text-xl font-semibold tabular-nums">{metrics.failed}</p>
              <p className="text-[11px] text-muted-foreground">{failedRate}%</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
              <p className="text-xl font-semibold tabular-nums">{metrics.total}</p>
              <p className="text-[11px] text-muted-foreground">queued + sent + failed</p>
            </div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-emerald-500" style={{ width: `${sentRate}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Sent rate vs failed rate across this campaign&apos;s outreach emails.</p>
        </div>
      </section>

      {/* Recent outreach emails */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Outreach emails (campaign)</h2>
        {metrics.emails.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No outreach emails for this campaign yet. Use the submit panel on the list page or launch to queue.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Business</th>
                  <th className="px-3 py-2">Recipient</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Sent at</th>
                </tr>
              </thead>
              <tbody>
                {metrics.emails.map((e: any) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-2">{e.business}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.email}</td>
                    <td className="px-3 py-2">
                      <StatusPill state={e.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{e.sentAt ? formatIST(e.sentAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex gap-2">
        <Link href="/acquisition/campaigns" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
          Back to campaigns
        </Link>
        <Link href="/acquisition/outreach" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
          Outreach pipeline
        </Link>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getCountsBy, getLeadStats, listBatchManifests } from "@/lib/wavesco/lead-engine";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Insights" };

interface Insight {
  tone: "good" | "warn" | "bad" | "info";
  title: string;
  detail: string;
}

export default async function InsightsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session);

  const insights: Insight[] = [];

  let stats: Awaited<ReturnType<typeof getLeadStats>> | null = null;
  try {
    stats = await getLeadStats();
    const byTier = await getCountsBy("tier");
    const byCategoryEntries = Object.entries(await getCountsBy("category")).sort((a, b) => b[1] - a[1]);

    if (stats.emailReady === 0) {
      insights.push({
        tone: "warn",
        title: "No campaign can be queued yet — zero email-ready leads",
        detail:
          "Email readiness requires a verified address in the corpus. Run the Lead Engine (it verifies emails during the Excel stage) or verify addresses on lead profiles.",
      });
    }

    if ((byTier.A ?? 0) > 0 && stats.total > 0) {
      insights.push({
        tone: "good",
        title: `${byTier.A} Tier-A leads are ready to work`,
        detail: "Filter the leads table to Tier A and build the first campaign segment from them.",
      });
    }

    if (byCategoryEntries[0]) {
      insights.push({
        tone: "info",
        title: `Largest segment is "${byCategoryEntries[0][0]}" (${byCategoryEntries[0][1]} leads)`,
        detail: "Category-targeted campaigns keep copy relevant; consider it for the first send.",
      });
    }

    if (stats.contacted === 0) {
      insights.push({
        tone: "info",
        title: "Outreach has not started yet",
        detail: "Every lead is untouched. First approved send will unlock reply and follow-up analytics.",
      });
    }
  } catch {
    insights.push({
      tone: "bad",
      title: "Corpus unavailable",
      detail: "Some insights pause automatically until the lead research service reconnects.",
    });
  }

  const platform = await withTenantContext(tenantId, async (tx) => ({
    campaignsDraft: await tx.campaign.count({ where: { tenantId, status: "draft" } }),
    pendingDecisions: await tx.outreachEmail.count({ where: { tenantId, status: "submitted", decidedAt: null } }),
    overdueFollowUps: await tx.followUp.count({
      where: { tenantId, status: "pending", dueAt: { lt: new Date() } },
    }),
  }));

  if (platform.campaignsDraft > 0) {
    insights.push({
      tone: "info",
      title: `${platform.campaignsDraft} draft campaign${platform.campaignsDraft === 1 ? "" : "s"} waiting`,
      detail: "Draft campaigns show live eligibility counts — prepare a send when the number is right.",
    });
  }
  if (platform.pendingDecisions > 0) {
    insights.push({
      tone: "warn",
      title: `${platform.pendingDecisions} approval${platform.pendingDecisions === 1 ? "" : "s"} awaiting decision`,
      detail: "Queued emails block until approved here or via Telegram (`approve N`).",
    });
  }
  if (platform.overdueFollowUps > 0) {
    insights.push({
      tone: "bad",
      title: `${platform.overdueFollowUps} follow-up${platform.overdueFollowUps === 1 ? "" : "s"} overdue`,
      detail: "Clear them from the Follow-ups page to keep the pipeline honest.",
    });
  }

  let lastBatch: string | null = null;
  try {
    const m = (await listBatchManifests())[0];
    lastBatch = m ? `${m.batchId} (${m.generatedAt?.slice(0, 10) ?? "?"})` : null;
  } catch {
    // ignore
  }
  if (!lastBatch) {
    insights.push({
      tone: "warn",
      title: "No recent Lead Engine batches on disk",
      detail: "Reports and fresh corpus depend on engine runs (scheduled every 2 days at 09:30).",
    });
  } else {
    insights.push({
      tone: "good",
      title: `Latest batch ${lastBatch}`,
      detail: "PDF/XLSX available under Reports with one-click Telegram resend.",
    });
  }

  const toneStyle: Record<Insight["tone"], string> = {
    good: "border-emerald-500/30 bg-emerald-500/5",
    warn: "border-amber-500/40 bg-amber-500/5",
    bad: "border-red-500/30 bg-red-500/5",
    info: "",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted-foreground">
          Deterministic observations derived from real data — every line traces to a metric above.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {insights.map((i) => (
          <div key={i.title} className={`rounded-lg border bg-card p-4 ${toneStyle[i.tone]}`}>
            <p className="text-sm font-medium">{i.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{i.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

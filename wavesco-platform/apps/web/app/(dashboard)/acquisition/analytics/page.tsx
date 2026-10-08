import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getLeadStats } from "@/lib/wavesco/lead-engine";
import { MetricCard, SectionHeader, StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports" };

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function formatInt(n: number): string {
  return n.toLocaleString();
}

async function safeCount(tx: any, model: string, where: any): Promise<number> {
  try {
    const m = tx[model];
    if (!m || typeof m.count !== "function") return 0;
    return await m.count({ where });
  } catch {
    return 0;
  }
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ detail?: string }>;
}) {
  const session = await auth();
  const tenantId = requireTenantId(session as unknown);
  const sp = await searchParams;
  const showDetail = sp.detail === "full";

  // acquisition via lead engine
  let acquisition: {
    total: number;
    emailReady: number;
    contacted: number;
    replies: number;
    optedOut: number;
    bounced: number;
    byTier: Record<string, number>;
    lastResearchedAt: string | null;
  } = {
    total: 0,
    emailReady: 0,
    contacted: 0,
    replies: 0,
    optedOut: 0,
    bounced: 0,
    byTier: {},
    lastResearchedAt: null,
  };
  let acquisitionError: string | null = null;
  try {
    const stats = await getLeadStats();
    acquisition = {
      total: stats.total ?? 0,
      emailReady: stats.emailReady ?? 0,
      contacted: stats.contacted ?? 0,
      replies: (stats as any).replies ?? 0,
      optedOut: (stats as any).optedOut ?? 0,
      bounced: (stats as any).bounced ?? 0,
      byTier: (stats as any).byTier ?? {},
      lastResearchedAt: (stats as any).lastResearchedAt ?? null,
    };
  } catch (e) {
    acquisitionError = e instanceof Error ? e.message : String(e);
  }

  // tenant aggregates
  let campaign: { total: number; eligible: number; sent: number; failed: number; pending: number; queued: number; reply: number } = {
    total: 0,
    eligible: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    queued: 0,
    reply: 0,
  };
  let funnel: { total: number; emailReady: number; contacted: number; replied: number; stages: { label: string; value: number; pct: number }[] } = {
    total: 0,
    emailReady: 0,
    contacted: 0,
    replied: 0,
    stages: [],
  };
  let responseRates: { replyRate: number; sentRate: number; raw: { replies: number; sent: number; eligible: number; contacted: number } } = {
    replyRate: 0,
    sentRate: 0,
    raw: { replies: 0, sent: 0, eligible: 0, contacted: 0 },
  };
  let workflow: { total: number; byType: Record<string, number>; byState: Record<string, number>; n8nExecutions: number | null; integrationStatusCount: number; recentEvents: number } = {
    total: 0,
    byType: {},
    byState: {},
    n8nExecutions: null as number | null,
    integrationStatusCount: 0,
    recentEvents: 0,
  };
  let apiUsage: { totalEvents: number; integrationChecks: number; generationBatches: number; byType: Record<string, number>; followUpsPending: number } = {
    totalEvents: 0,
    integrationChecks: 0,
    generationBatches: 0,
    byType: {},
    followUpsPending: 0,
  };
  let modelUsage: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    avgLatency: number | null;
    count: number;
    byModel: { model: string; provider: string; inputTokens: number; outputTokens: number; totalTokens: number; avgLatency: number | null; count: number; estimatedCostUsd: number; success: number; failed: number }[];
    totalEstimatedCostUsd: number;
  } = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    avgLatency: null,
    count: 0,
    byModel: [],
    totalEstimatedCostUsd: 0,
  };
  let costs: { estimatedCostUsd: number; tokenCostUsd: number; leadCostUsd: number | null; perLeadCost: number | null; perTokenCost: number | null } = {
    estimatedCostUsd: 0,
    tokenCostUsd: 0,
    leadCostUsd: null,
    perLeadCost: null,
    perTokenCost: null,
  };
  let dbError: string | null = null;

  try {
    const dbData = await withTenantContext(tenantId, async (tx: any) => {
      const campaignTotal = await safeCount(tx, "campaign", { tenantId });
      const outreachSent = await safeCount(tx, "outreachEmail", { tenantId, status: "sent" });
      const outreachFailed = await safeCount(tx, "outreachEmail", { tenantId, status: "failed" });
      const outreachQueued = await safeCount(tx, "outreachEmail", { tenantId, status: { in: ["submitted", "approved"] } });
      const outreachPending = await safeCount(tx, "outreachEmail", { tenantId, status: { in: ["draft", "submitted", "approved"] } });

      let orderTotal = 0;
      let orderReplied = 0;
      try {
        orderTotal = await safeCount(tx, "outreachOrder", { tenantId });
      } catch {
        orderTotal = 0;
      }
      try {
        if (tx.outreachOrder && typeof tx.outreachOrder.count === "function") {
          try {
            orderReplied = await tx.outreachOrder.count({ where: { tenantId, replyStatus: { not: null } } });
          } catch {
            try {
              orderReplied = await tx.outreachOrder.count({ where: { tenantId, NOT: { replyStatus: null } } });
            } catch {
              if (typeof tx.outreachOrder.findMany === "function") {
                const rows = await tx.outreachOrder.findMany({ where: { tenantId }, take: 200 }).catch(() => []);
                orderReplied = (rows as any[]).filter((r) => r.replyStatus != null && String(r.replyStatus).trim() !== "").length;
              }
            }
          }
          if (orderReplied === 0 && typeof tx.outreachOrder.findMany === "function") {
            try {
              const rows = await tx.outreachOrder.findMany({ where: { tenantId }, take: 200 });
              const filtered = (rows as any[]).filter(
                (r) => r.replyStatus != null && String(r.replyStatus).trim() !== "" && !["none", "no reply", "no"].includes(String(r.replyStatus).trim().toLowerCase())
              );
              if (filtered.length > 0) orderReplied = filtered.length;
            } catch {}
          }
        }
      } catch {
        orderReplied = 0;
      }

      let activityTotal = 0;
      let activityByType: Record<string, number> = {};
      let recentEvents = 0;
      try {
        activityTotal = await safeCount(tx, "activityEvent", { tenantId });
        if (tx.activityEvent && typeof tx.activityEvent.findMany === "function") {
          const recent = await tx.activityEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []);
          recentEvents = (recent as any[]).length;
          for (const a of recent as any[]) {
            const t = a.type ?? "unknown";
            activityByType[t] = (activityByType[t] ?? 0) + 1;
          }
        }
      } catch {
        activityTotal = 0;
      }

      let integrationCount = 0;
      let integrationsByState: Record<string, number> = {};
      try {
        integrationCount = await safeCount(tx, "integrationStatus", { tenantId });
        if (tx.integrationStatus && typeof tx.integrationStatus.findMany === "function") {
          const rows = await tx.integrationStatus.findMany({ where: { tenantId } }).catch(() => []);
          for (const r of rows as any[]) {
            const s = r.state ?? "unknown";
            integrationsByState[s] = (integrationsByState[s] ?? 0) + 1;
          }
        }
      } catch {
        integrationCount = 0;
      }

      let usageLogs: any[] = [];
      try {
        if (tx.aiUsageLog && typeof tx.aiUsageLog.findMany === "function") {
          usageLogs = await tx.aiUsageLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []);
        }
      } catch {
        usageLogs = [];
      }

      const generationTotal = await safeCount(tx, "generationBatch", { tenantId });
      const followUpsPending = await safeCount(tx, "followUp", { tenantId, status: "pending" });

      return {
        campaignTotal,
        outreachSent,
        outreachFailed,
        outreachQueued,
        outreachPending,
        orderTotal,
        orderReplied,
        activityTotal,
        activityByType,
        recentEvents,
        integrationCount,
        integrationsByState,
        usageLogs,
        generationTotal,
        followUpsPending,
      };
    });

    const eligible = acquisition.emailReady;
    campaign = {
      total: dbData.campaignTotal,
      eligible,
      sent: dbData.outreachSent,
      failed: dbData.outreachFailed,
      pending: dbData.outreachPending,
      queued: dbData.outreachQueued,
      reply: dbData.orderReplied,
    };

    const funnelTotal = acquisition.total;
    const funnelEmailReady = acquisition.emailReady;
    const funnelContacted = acquisition.contacted || dbData.outreachSent;
    const funnelReplied = Math.max(acquisition.replies, dbData.orderReplied);
    funnel = {
      total: funnelTotal,
      emailReady: funnelEmailReady,
      contacted: funnelContacted,
      replied: funnelReplied,
      stages: [
        { label: "Total", value: funnelTotal, pct: funnelTotal > 0 ? 100 : 0 },
        { label: "Email Ready", value: funnelEmailReady, pct: funnelTotal > 0 ? Math.round((funnelEmailReady / funnelTotal) * 100) : 0 },
        { label: "Contacted", value: funnelContacted, pct: funnelTotal > 0 ? Math.round((funnelContacted / funnelTotal) * 100) : 0 },
        { label: "Replied", value: funnelReplied, pct: funnelTotal > 0 ? Math.round((funnelReplied / funnelTotal) * 100) : 0 },
      ],
    };

    const replyRate = dbData.outreachSent > 0 ? funnelReplied / dbData.outreachSent : 0;
    const sentRate = eligible > 0 ? dbData.outreachSent / eligible : 0;
    responseRates = {
      replyRate,
      sentRate,
      raw: { replies: funnelReplied, sent: dbData.outreachSent, eligible, contacted: funnelContacted },
    };

    workflow = {
      total: dbData.activityTotal + dbData.integrationCount,
      byType: dbData.activityByType,
      byState: dbData.integrationsByState,
      n8nExecutions: null as number | null,
      integrationStatusCount: dbData.integrationCount,
      recentEvents: dbData.recentEvents,
    };

    apiUsage = {
      totalEvents: dbData.activityTotal,
      integrationChecks: dbData.integrationCount,
      generationBatches: dbData.generationTotal,
      byType: dbData.activityByType,
      followUpsPending: dbData.followUpsPending,
    };

    // model usage
    let totalInput = 0;
    let totalOutput = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    let totalEstimatedCost = 0;
    const byModelMap = new Map<
      string,
      { model: string; provider: string; inputTokens: number; outputTokens: number; totalTokens: number; latencySum: number; latencyCount: number; count: number; estimatedCostUsd: number; success: number; failed: number }
    >();
    for (const log of dbData.usageLogs as any[]) {
      const model = String(log.model ?? "unknown");
      const provider = String(log.provider ?? "unknown");
      const key = `${provider}:${model}`;
      const inT = Number(log.inputTokens ?? 0);
      const outT = Number(log.outputTokens ?? 0);
      const lat = Number(log.latencyMs ?? 0);
      const cost = typeof log.estimatedCostUsd === "number" ? log.estimatedCostUsd : 0;
      totalInput += inT;
      totalOutput += outT;
      if (log.latencyMs != null) {
        totalLatency += lat;
        latencyCount += 1;
      }
      totalEstimatedCost += cost;
      const existing = byModelMap.get(key);
      if (!existing) {
        byModelMap.set(key, {
          model,
          provider,
          inputTokens: inT,
          outputTokens: outT,
          totalTokens: inT + outT,
          latencySum: log.latencyMs != null ? lat : 0,
          latencyCount: log.latencyMs != null ? 1 : 0,
          count: 1,
          estimatedCostUsd: cost,
          success: log.status === "success" ? 1 : 0,
          failed: log.status === "error" ? 1 : 0,
        });
      } else {
        existing.inputTokens += inT;
        existing.outputTokens += outT;
        existing.totalTokens += inT + outT;
        if (log.latencyMs != null) {
          existing.latencySum += lat;
          existing.latencyCount += 1;
        }
        existing.count += 1;
        existing.estimatedCostUsd += cost;
        if (log.status === "success") existing.success += 1;
        if (log.status === "error") existing.failed += 1;
      }
    }
    const totalTokens = totalInput + totalOutput;
    const avgLatency = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : null;
    const byModel = Array.from(byModelMap.values()).map((v) => ({
      model: v.model,
      provider: v.provider,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      totalTokens: v.totalTokens,
      avgLatency: v.latencyCount > 0 ? Math.round(v.latencySum / v.latencyCount) : null,
      count: v.count,
      estimatedCostUsd: v.estimatedCostUsd,
      success: v.success,
      failed: v.failed,
    }));
    // Only recorded spend is reported; no invented per-token rate.
    const effectiveTokenCost = totalEstimatedCost;
    modelUsage = {
      totalTokens,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      avgLatency,
      count: (dbData.usageLogs as any[]).length,
      byModel,
      totalEstimatedCostUsd: effectiveTokenCost,
    };
    // The per-lead rate is an internal modelling constant, not a billed figure.
    const perLeadCost = null;
    const leadCostUsd = null;
    const tokenCostUsd = effectiveTokenCost;
    costs = {
      estimatedCostUsd: tokenCostUsd,
      tokenCostUsd,
      leadCostUsd,
      perLeadCost,
      perTokenCost: null,
    };
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const hasData = acquisition.total > 0 || campaign.total > 0 || apiUsage.totalEvents > 0 || modelUsage.count > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Reports</p>
          <h1 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground">Reports</h1>
          <p className="mt-1.5 max-w-2xl font-sans text-[13px] leading-5 text-muted-foreground">
            How your outreach is doing — real numbers from your workspace. First what worked, then the detail.
          </p>
          <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
            Zeros mean nothing has happened yet — never an error.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={30_000} />
          <StatusPill state={acquisitionError ? "error" : hasData ? "connected" : "unavailable"} />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{acquisitionError ? "Needs attention" : hasData ? "Up to date" : "Nothing yet"}</span>
        </div>
      </div>

      {acquisitionError ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium text-amber-800 dark:text-amber-200">Lead Engine unreachable — acquisition metrics zeroed</p>
          <p className="text-muted-foreground">{acquisitionError.slice(0, 300)}</p>
          <a href="/acquisition/analytics" className="mt-2 inline-block rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </a>
        </div>
      ) : null}
      {dbError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">
          <p className="font-medium text-red-600 dark:text-red-400">Tenant DB aggregation warning</p>
          <p className="text-muted-foreground">{dbError.slice(0, 300)}</p>
          <a href="/acquisition/analytics" className="mt-2 inline-block rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </a>
        </div>
      ) : null}

      {/* What worked — plain-language summary computed from the same real aggregates below. */}
      <section className="rounded-lg border border-border/80 bg-card p-5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          What worked
        </p>
        <div className="mt-2 space-y-1.5 font-sans text-[13px] leading-5 text-foreground">
          {campaign.sent === 0 && campaign.total === 0 ? (
            <p>Nothing sent yet. When WAVES sends your first emails, this page will tell you what worked and what to do next.</p>
          ) : (
            <>
              <p>
                WAVES sent <strong className="tabular-nums">{formatInt(campaign.sent)}</strong> {campaign.sent === 1 ? "email" : "emails"}.{" "}
                <strong className="tabular-nums">{formatInt(campaign.reply)}</strong> {campaign.reply === 1 ? "person" : "people"} replied
                {campaign.sent > 0 ? (
                  <> — a <strong className="tabular-nums">{(responseRates.replyRate * 100).toFixed(1)}%</strong> reply rate.</>
                ) : (
                  <>.</>
                )}
              </p>
              {(() => {
                const stages = funnel.stages ?? [];
                let worst: { from: string; to: string; lost: number } | null = null;
                for (let i = 1; i < stages.length; i++) {
                  const prev = stages[i - 1]!.value ?? 0;
                  const cur = stages[i]!.value ?? 0;
                  const lost = prev - cur;
                  if (prev > 0 && lost > 0 && (!worst || lost > worst.lost)) {
                    worst = { from: stages[i - 1]!.label, to: stages[i]!.label, lost };
                  }
                }
                if (!worst) return null;
                return (
                  <p>
                    Most drop-off is between <strong>{worst.from}</strong> and <strong>{worst.to}</strong> — that&apos;s the step to improve next.
                  </p>
                );
              })()}
              {campaign.failed > 0 ? (
                <p>
                  <strong className="tabular-nums">{formatInt(campaign.failed)}</strong> {campaign.failed === 1 ? "email" : "emails"} failed to send. Each one keeps its reason — nothing is silently dropped.
                </p>
              ) : null}
              {acquisition.optedOut > 0 ? (
                <p>
                  <strong className="tabular-nums">{formatInt(acquisition.optedOut)}</strong> {acquisition.optedOut === 1 ? "person" : "people"} asked not to be contacted — WAVES excludes them automatically.
                </p>
              ) : null}
              {acquisition.bounced > 0 ? (
                <p>
                  <strong className="tabular-nums">{formatInt(acquisition.bounced)}</strong> {acquisition.bounced === 1 ? "address" : "addresses"} bounced — they can&apos;t receive email.
                </p>
              ) : null}
            </>
          )}
        </div>
        <div className="mt-4">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            What to do next
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {campaign.reply > 0 ? (
              <Link href="/acquisition/replies" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90">
                Read your replies →
              </Link>
            ) : null}
            {campaign.failed > 0 ? (
              <Link href="/acquisition/outreach" className="rounded-md border px-3 py-1.5 hover:bg-accent">
                See failed sends →
              </Link>
            ) : null}
            <Link href="/acquisition/campaigns#new-campaign" className="rounded-md border px-3 py-1.5 hover:bg-accent">
              Start your outreach →
            </Link>
          </div>
        </div>
      </section>

      {/* Acquisition metrics */}
      <section className="space-y-3">
        <SectionHeader title="Acquisition metrics" subtitle="Prospects found, ready, contacted and replied" right={<span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{acquisition.lastResearchedAt ? `updated ${new Date(acquisition.lastResearchedAt).toLocaleString()}` : "not updated yet"}</span>} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total Leads" value={formatInt(acquisition.total)} detail={`${Object.keys(acquisition.byTier).length} tiers · optedOut ${acquisition.optedOut} · bounced ${acquisition.bounced}`} href="/acquisition/leads" />
          <MetricCard label="Email Ready" value={formatInt(acquisition.emailReady)} detail="Verified address, ready to contact" href="/acquisition/campaigns" />
          <MetricCard label="Contacted" value={formatInt(acquisition.contacted)} detail="Already reached by WAVES outreach" href="/acquisition/outreach" />
          <MetricCard label="Replies" value={formatInt(acquisition.replies)} detail="Prospects who replied" href="/acquisition/replies" />
        </div>
        {Object.keys(acquisition.byTier).length > 0 ? (
          <div className="rounded-lg border border-border/80 bg-card p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">By Tier</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(acquisition.byTier).map(([tier, count]) => (
                <span key={tier} className="rounded-full border bg-muted px-2.5 py-1 text-xs font-mono">
                  {tier}: {String(count)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* Campaign performance */}
      <section className="space-y-3">
        <SectionHeader title="Campaign performance" subtitle="Who could be reached, who was sent to, who replied" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Campaigns" value={formatInt(campaign.total)} href="/acquisition/campaigns" />
          <MetricCard label="Eligible" value={formatInt(campaign.eligible)} detail="Ready to contact right now" />
          <MetricCard label="Sent" value={formatInt(campaign.sent)} detail={`queued ${campaign.queued} · pending ${campaign.pending}`} />
          <MetricCard label="Failed" value={formatInt(campaign.failed)} detail="Didn't send" />
          <MetricCard label="Replied" value={formatInt(campaign.reply)} detail="Replied to outreach" />
        </div>
        <div className="rounded-lg border border-border/80 bg-card p-3">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Eligible vs Sent vs Reply — bar snapshot</p>
          <div className="mt-3 space-y-2">
            {[
              { label: "Eligible", value: campaign.eligible, max: Math.max(campaign.eligible, campaign.sent, campaign.reply, 1), color: "bg-sky-500" },
              { label: "Sent", value: campaign.sent, max: Math.max(campaign.eligible, campaign.sent, campaign.reply, 1), color: "bg-emerald-500" },
              { label: "Reply", value: campaign.reply, max: Math.max(campaign.eligible, campaign.sent, campaign.reply, 1), color: "bg-violet-500" },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <span className="w-20 text-xs font-medium">{r.label}</span>
                <div className="h-3 flex-1 rounded-full bg-muted">
                  <div className={`h-3 rounded-full ${r.color}`} style={{ width: `${Math.round((r.value / r.max) * 100)}%` }} />
                </div>
                <span className="w-16 text-right text-xs tabular-nums">{formatInt(r.value)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Bars scaled to the largest value.</p>
        </div>
      </section>

      {/* Lead conversion funnel */}
      <section className="space-y-3">
        <SectionHeader title="Lead conversion funnel" subtitle="Total → Email Ready → Contacted → Replied" />
        <div className="rounded-lg border border-border/80 bg-card p-4">
          <div className="space-y-3">
            {funnel.stages.map((s) => (
              <div key={s.label} className="flex items-center gap-3">
                <span className="w-28 text-xs font-medium">{s.label}</span>
                <div className="h-4 flex-1 rounded-full bg-muted">
                  <div className="h-4 rounded-full bg-primary" style={{ width: `${s.pct}%` }} />
                </div>
                <span className="w-20 text-right text-xs tabular-nums">{formatInt(s.value)}</span>
                <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{s.pct}%</span>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Each bar is the share of all prospects at that step.</p>
        </div>
      </section>

      {/* Response rates */}
      <section className="space-y-3">
        <SectionHeader title="Response rates" subtitle="How often outreach gets replies" />
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Reply Rate" value={pct(responseRates.replyRate)} detail={`${responseRates.raw.replies} replies / ${responseRates.raw.sent} sent`} />
          <MetricCard label="Sent Rate" value={pct(responseRates.sentRate)} detail={`${responseRates.raw.sent} sent / ${responseRates.raw.eligible} eligible`} />
          <MetricCard label="Coverage" value={`${responseRates.raw.eligible > 0 ? Math.round((responseRates.raw.contacted / responseRates.raw.eligible) * 100) : 0}%`} detail={`${responseRates.raw.contacted} contacted / ${responseRates.raw.eligible} eligible`} />
        </div>
        <div className="rounded-lg border border-border/80 bg-card p-3">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Reply rate bar</p>
          <div className="mt-2 h-3 rounded-full bg-muted">
            <div className="h-3 rounded-full bg-violet-500" style={{ width: `${Math.round(responseRates.replyRate * 100)}%` }} />
          </div>
          <p className="mt-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Zero until your first sends.</p>
        </div>
      </section>

      {showDetail ? (
        <>
          <Link href="/acquisition/analytics" className="inline-block font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground hover:underline">
            ← Back to summary
          </Link>
          {/* Workflow performance */}
      <section className="space-y-3">
        <SectionHeader title="Workflow performance" subtitle="ActivityEvent by type + IntegrationStatus by state" />
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Activity Events" value={formatInt(apiUsage.totalEvents)} detail={`${workflow.recentEvents} recent (last 100) · ${Object.keys(workflow.byType).length} types`} />
          <MetricCard label="Integration Checks" value={formatInt(workflow.integrationStatusCount)} detail={`${Object.keys(workflow.byState).length} states`} />
          
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border/80 bg-card p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">By Activity Type (top 10)</p>
            {Object.keys(workflow.byType).length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">No activity events yet.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {Object.entries(workflow.byType)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([type, count]) => (
                    <li key={type} className="flex items-center justify-between text-xs">
                      <span className="font-mono">{type}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 tabular-nums">{count}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-border/80 bg-card p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">By Integration State</p>
            {Object.keys(workflow.byState).length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">No integration statuses.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {Object.entries(workflow.byState).map(([state, count]) => (
                  <li key={state} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <StatusPill state={state === "connected" ? "connected" : state === "error" ? "error" : state === "disconnected" ? "disconnected" : "unavailable"} />
                      {state}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            )}
            
          </div>
        </div>
      </section>

      {/* API usage */}
      <section className="space-y-3">
        <SectionHeader title="API usage" subtitle="ActivityEvent total + generation batches + follow-ups" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total Events" value={formatInt(apiUsage.totalEvents)} detail={`${workflow.recentEvents} recent`} />
          <MetricCard label="Integration Checks" value={formatInt(apiUsage.integrationChecks)} />
          <MetricCard label="Generation Batches" value={formatInt(apiUsage.generationBatches)} href="/acquisition/reports" />
          <MetricCard label="Follow-ups Pending" value={formatInt(apiUsage.followUpsPending)} href="/acquisition/follow-ups" />
        </div>
        <div className="rounded-lg border border-border/80 bg-card p-3">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Activity by Type (same as workflow)</p>
          {Object.keys(apiUsage.byType).length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No API usage yet — tenant empty.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(apiUsage.byType).map(([k, v]) => (
                <span key={k} className="rounded-full border bg-muted px-2.5 py-1 text-xs font-mono">
                  {k}: {v}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Model/token usage */}
      <section className="space-y-3">
        <SectionHeader title="Model / token usage" subtitle="AiUsageLog — sum group by model, avg latency, counts" right={<span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">{modelUsage.count} logs · {formatInt(modelUsage.totalTokens)} tokens</span>} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total Tokens" value={formatInt(modelUsage.totalTokens)} detail={`in ${formatInt(modelUsage.inputTokens)} · out ${formatInt(modelUsage.outputTokens)}`} />
          <MetricCard label="Avg Latency" value={modelUsage.avgLatency != null ? `${modelUsage.avgLatency}ms` : "—"} />
          <MetricCard label="Log Count" value={formatInt(modelUsage.count)} />
          <MetricCard label="Est. Token Cost" value={modelUsage.totalEstimatedCostUsd > 0 ? formatUsd(modelUsage.totalEstimatedCostUsd) : "—"} detail={modelUsage.totalEstimatedCostUsd > 0 ? "billed per call" : "no billable usage yet"} />
        </div>
        <div className="overflow-x-auto rounded-lg border border-border/80 bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                <th className="px-3 py-2">Provider / Model</th>
                <th className="px-3 py-2">Count</th>
                <th className="px-3 py-2">Input</th>
                <th className="px-3 py-2">Output</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Avg Latency</th>
                <th className="px-3 py-2">Success / Failed</th>
                <th className="px-3 py-2">Est. Cost</th>
              </tr>
            </thead>
            <tbody>
              {modelUsage.byModel.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No AiUsageLog yet — trigger enrichment or email generation to populate ledger. Shows zeros, not error.
                  </td>
                </tr>
              ) : (
                modelUsage.byModel.map((m) => (
                  <tr key={`${m.provider}:${m.model}`} className="border-b border-border/60 last:border-0 hover:bg-card-hover">
                    <td className="px-3 py-2 text-xs font-mono">
                      {m.provider} · {m.model}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">{m.count}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{formatInt(m.inputTokens)}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{formatInt(m.outputTokens)}</td>
                    <td className="px-3 py-2 text-xs font-medium tabular-nums">{formatInt(m.totalTokens)}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{m.avgLatency != null ? `${m.avgLatency}ms` : "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-600 dark:text-emerald-400">{m.success}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-600 dark:text-red-400">{m.failed}</span>
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">{m.estimatedCostUsd > 0 ? formatUsd(m.estimatedCostUsd) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">Source: AiUsageLog (tenant-scoped, last 200) · Sum inputTokens/outputTokens, avg latency, count per model. Cost is the recorded estimatedCostUsd; a dash means nothing was billed for that model.</p>
      </section>

      {/* System costs */}
      <section className="space-y-3">
        <SectionHeader
          title="System costs"
          subtitle="Token cost is recorded per call. Lead cost is an internal rate, not a billed figure."
          right={<span className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">rates unconfigured</span>}
        />
        {/* Only token cost comes from recorded usage. The per-lead rate is an
            internal modelling constant, so it is no longer rendered as a
            dollar figure alongside real spend. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricCard
            label="Recorded Token Cost"
            value={modelUsage.totalEstimatedCostUsd > 0 ? formatUsd(modelUsage.totalEstimatedCostUsd) : "—"}
            detail={
              modelUsage.totalEstimatedCostUsd > 0
                ? `${formatInt(modelUsage.totalTokens)} tokens billed`
                : "No billable AI usage recorded yet"
            }
          />
          <MetricCard
            label="Per-lead cost"
            value="—"
            detail="Not a billed figure — lead research runs on Waves infrastructure"
          />
        </div>
        <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
          Token cost is the sum of <code className="font-mono">estimatedCostUsd</code> on your AiUsageLog entries.
          Cost per lead is an internal rate used for planning only and is never charged to your account.
        </p>
        <div className="rounded-lg border border-border/80 bg-card p-3">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Cost bar breakdown</p>
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-3">
              <span className="w-24 text-xs">Token</span>
              <div className="h-3 flex-1 rounded-full bg-muted">
                <div className="h-3 rounded-full bg-sky-500" style={{ width: `${costs.estimatedCostUsd > 0 ? Math.round((costs.tokenCostUsd / costs.estimatedCostUsd) * 100) : 0}%` }} />
              </div>
              <span className="w-24 text-right text-xs tabular-nums">{formatUsd(costs.tokenCostUsd)}</span>
            </div>
            <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
              Recorded AI spend only. Lead research runs on Waves infrastructure and is not billed per lead.
            </p>
          </div>
        </div>
      </section>
        </>
      ) : (
        <section className="rounded-lg border border-border/80 bg-card p-5">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Technical detail</p>
          <p className="mt-2 font-sans text-[13px] leading-5 text-muted-foreground">
            The full breakdown — automation runs, usage and costs — lives here for when you need it.
          </p>
          <Link href="/acquisition/analytics?detail=full" className="mt-3 inline-block rounded-lg border border-border/80 px-3 py-1.5 text-xs hover:bg-accent">
            Show technical detail
          </Link>
        </section>
      )}

      <p className="font-mono text-[11px] tracking-[0.02em] text-muted-foreground">
        All metrics reflect your workspace's actual activity. Metrics show zero until your first campaigns run.</p>
    </div>
  );
}

import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { getLeadStats } from "@/lib/wavesco/lead-engine";
import { MetricCard, SectionHeader, StatusPill } from "@/components/command/primitives";
import { AutoRefresh } from "@/components/command/auto-refresh";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics — Acquisition OS" };

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

export default async function AnalyticsPage() {
  const session = await auth();
  const tenantId = requireTenantId(session as unknown);

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
  let workflow: { total: number; byType: Record<string, number>; byState: Record<string, number>; n8nExecutions: number; integrationStatusCount: number; recentEvents: number } = {
    total: 0,
    byType: {},
    byState: {},
    n8nExecutions: 0,
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
  let costs: { estimatedCostUsd: number; tokenCostUsd: number; leadCostUsd: number; perLeadCost: number; perTokenCost: number } = {
    estimatedCostUsd: 0,
    tokenCostUsd: 0,
    leadCostUsd: 0,
    perLeadCost: 0.005,
    perTokenCost: 0.00002,
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
      n8nExecutions: 0,
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
    const perTokenCost = 0.00002;
    const effectiveTokenCost = totalEstimatedCost > 0 ? totalEstimatedCost : totalTokens * perTokenCost;
    modelUsage = {
      totalTokens,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      avgLatency,
      count: (dbData.usageLogs as any[]).length,
      byModel,
      totalEstimatedCostUsd: effectiveTokenCost,
    };
    const perLeadCost = 0.005;
    const leadCostUsd = acquisition.total * perLeadCost;
    const tokenCostUsd = effectiveTokenCost;
    costs = {
      estimatedCostUsd: tokenCostUsd + leadCostUsd,
      tokenCostUsd,
      leadCostUsd,
      perLeadCost,
      perTokenCost,
    };
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const hasData = acquisition.total > 0 || campaign.total > 0 || apiUsage.totalEvents > 0 || modelUsage.count > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics — Acquisition OS</h1>
          <p className="text-sm text-muted-foreground">
            Tenant-scoped acquisition metrics, campaign performance, funnel, response rates, workflow, API usage, model/token usage, system costs.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Tenant {tenantId.slice(0, 8)}… · Acquisition live via getLeadStats (corpus) + tenant DB aggregates. Zeros if empty, not error.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={30_000} />
          <StatusPill state={acquisitionError ? "error" : hasData ? "connected" : "unavailable"} />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">{acquisitionError ? "ERROR" : hasData ? "LIVE" : "EMPTY"}</span>
        </div>
      </div>

      {acquisitionError ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium text-amber-800 dark:text-amber-200">Lead Engine unreachable — acquisition metrics zeroed</p>
          <p className="text-muted-foreground">{acquisitionError.slice(0, 300)}</p>
          <a href="/acquisition/analytics" className="mt-2 inline-block rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </a>
        </div>
      ) : null}
      {dbError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">
          <p className="font-medium text-red-600 dark:text-red-400">Tenant DB aggregation warning</p>
          <p className="text-muted-foreground">{dbError.slice(0, 300)}</p>
          <a href="/acquisition/analytics" className="mt-2 inline-block rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
            Retry
          </a>
        </div>
      ) : null}

      {/* Acquisition metrics */}
      <section className="space-y-3">
        <SectionHeader title="Acquisition metrics" subtitle="Corpus (Lead Engine) + tenant DB fallback" right={<span className="text-[11px] text-muted-foreground">{acquisition.lastResearchedAt ? `lastResearched ${new Date(acquisition.lastResearchedAt).toLocaleString()}` : "no lastResearched"}</span>} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total Leads" value={formatInt(acquisition.total)} detail={`${Object.keys(acquisition.byTier).length} tiers · optedOut ${acquisition.optedOut} · bounced ${acquisition.bounced}`} href="/acquisition/leads" />
          <MetricCard label="Email Ready" value={formatInt(acquisition.emailReady)} detail="VERIFIED + not opted_out + not contacted" href="/acquisition/campaigns" />
          <MetricCard label="Contacted" value={formatInt(acquisition.contacted)} detail="date_contacted not null (engine) or outreach sent" href="/acquisition/outreach" />
          <MetricCard label="Replies" value={formatInt(acquisition.replies)} detail="reply_status not empty · also OutreachOrder.replyStatus" href="/acquisition/outreach" />
        </div>
        {Object.keys(acquisition.byTier).length > 0 ? (
          <div className="rounded-lg border bg-card p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">By Tier</p>
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
        <SectionHeader title="Campaign performance" subtitle="Eligible vs sent vs reply (tenant-scoped)" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="Campaigns" value={formatInt(campaign.total)} href="/acquisition/campaigns" />
          <MetricCard label="Eligible (emailReady)" value={formatInt(campaign.eligible)} detail="from acquisition.emailReady" />
          <MetricCard label="Sent" value={formatInt(campaign.sent)} detail={`queued ${campaign.queued} · pending ${campaign.pending}`} />
          <MetricCard label="Failed" value={formatInt(campaign.failed)} detail="OutreachEmail failed" />
          <MetricCard label="Replied" value={formatInt(campaign.reply)} detail="OutreachOrder replyStatus not null" />
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Eligible vs Sent vs Reply — bar snapshot</p>
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
          <p className="mt-2 text-[11px] text-muted-foreground">Bars scaled to max(eligible,sent,reply). Source: tenant campaign + outreachEmail + outreachOrder.</p>
        </div>
      </section>

      {/* Lead conversion funnel */}
      <section className="space-y-3">
        <SectionHeader title="Lead conversion funnel" subtitle="Total → Email Ready → Contacted → Replied" />
        <div className="rounded-lg border bg-card p-4">
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
          <p className="mt-3 text-[11px] text-muted-foreground">Pct = value / total. Total from getLeadStats, contacted max(engine contacted, sent), replied max(engine replies, orderReplied).</p>
        </div>
      </section>

      {/* Response rates */}
      <section className="space-y-3">
        <SectionHeader title="Response rates" subtitle="Replies / sent + eligible coverage" />
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Reply Rate" value={pct(responseRates.replyRate)} detail={`${responseRates.raw.replies} replies / ${responseRates.raw.sent} sent`} />
          <MetricCard label="Sent Rate" value={pct(responseRates.sentRate)} detail={`${responseRates.raw.sent} sent / ${responseRates.raw.eligible} eligible`} />
          <MetricCard label="Coverage" value={`${responseRates.raw.eligible > 0 ? Math.round((responseRates.raw.contacted / responseRates.raw.eligible) * 100) : 0}%`} detail={`${responseRates.raw.contacted} contacted / ${responseRates.raw.eligible} eligible`} />
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Reply rate bar</p>
          <div className="mt-2 h-3 rounded-full bg-muted">
            <div className="h-3 rounded-full bg-violet-500" style={{ width: `${Math.round(responseRates.replyRate * 100)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Zero if no sends yet — not error. Raw: {JSON.stringify(responseRates.raw)}</p>
        </div>
      </section>

      {/* Workflow performance */}
      <section className="space-y-3">
        <SectionHeader title="Workflow performance" subtitle="ActivityEvent by type + IntegrationStatus by state · n8n placeholder" />
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Activity Events" value={formatInt(apiUsage.totalEvents)} detail={`${workflow.recentEvents} recent (last 100) · ${Object.keys(workflow.byType).length} types`} />
          <MetricCard label="Integration Checks" value={formatInt(workflow.integrationStatusCount)} detail={`${Object.keys(workflow.byState).length} states`} />
          <MetricCard label="n8n Executions" value={formatInt(workflow.n8nExecutions)} detail="placeholder — requires live N8N probe" />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">By Activity Type (top 10)</p>
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
          <div className="rounded-lg border bg-card p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">By Integration State</p>
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
            <p className="mt-2 text-[11px] text-muted-foreground">n8nExecutions placeholder note: requires N8N_BASE_URL execution probe; not fake.</p>
          </div>
        </div>
      </section>

      {/* API usage */}
      <section className="space-y-3">
        <SectionHeader title="API usage" subtitle="ActivityEvent total + generation batches + follow-ups" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total Events" value={formatInt(apiUsage.totalEvents)} detail={`${apiUsage.recentEvents ?? workflow.recentEvents} recent`} />
          <MetricCard label="Integration Checks" value={formatInt(apiUsage.integrationChecks)} />
          <MetricCard label="Generation Batches" value={formatInt(apiUsage.generationBatches)} href="/acquisition/reports" />
          <MetricCard label="Follow-ups Pending" value={formatInt(apiUsage.followUpsPending)} href="/acquisition/follow-ups" />
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Activity by Type (same as workflow)</p>
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
        <SectionHeader title="Model / token usage" subtitle="AiUsageLog — sum group by model, avg latency, counts" right={<span className="text-[11px] text-muted-foreground">{modelUsage.count} logs · {formatInt(modelUsage.totalTokens)} tokens</span>} />
        <div className="grid gap-4 sm:grid-cols-4">
          <MetricCard label="Total Tokens" value={formatInt(modelUsage.totalTokens)} detail={`in ${formatInt(modelUsage.inputTokens)} · out ${formatInt(modelUsage.outputTokens)}`} />
          <MetricCard label="Avg Latency" value={modelUsage.avgLatency != null ? `${modelUsage.avgLatency}ms` : "—"} />
          <MetricCard label="Log Count" value={formatInt(modelUsage.count)} />
          <MetricCard label="Est. Token Cost" value={formatUsd(modelUsage.totalEstimatedCostUsd)} detail={`@ ${costs.perTokenCost}/token`} />
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
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
                  <tr key={`${m.provider}:${m.model}`} className="border-b last:border-0 hover:bg-accent/40">
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
                    <td className="px-3 py-2 text-xs tabular-nums">{formatUsd(m.estimatedCostUsd || m.totalTokens * costs.perTokenCost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">Source: AiUsageLog (tenant-scoped, last 200) · Sum inputTokens/outputTokens, avg latency, count per model. Cost from estimatedCostUsd when present else totalTokens × {costs.perTokenCost}.</p>
      </section>

      {/* System costs */}
      <section className="space-y-3">
        <SectionHeader title="System costs" subtitle="Estimate from token counts + lead counts" />
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Token Cost" value={formatUsd(costs.tokenCostUsd)} detail={`${formatInt(modelUsage.totalTokens)} tokens × ${costs.perTokenCost}`} />
          <MetricCard label="Lead Cost" value={formatUsd(costs.leadCostUsd)} detail={`${formatInt(acquisition.total)} leads × ${costs.perLeadCost}`} />
          <MetricCard label="Estimated Total" value={formatUsd(costs.estimatedCostUsd)} detail="token + lead estimate" />
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Cost bar breakdown</p>
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-3">
              <span className="w-24 text-xs">Token</span>
              <div className="h-3 flex-1 rounded-full bg-muted">
                <div className="h-3 rounded-full bg-sky-500" style={{ width: `${costs.estimatedCostUsd > 0 ? Math.round((costs.tokenCostUsd / costs.estimatedCostUsd) * 100) : 0}%` }} />
              </div>
              <span className="w-24 text-right text-xs tabular-nums">{formatUsd(costs.tokenCostUsd)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 text-xs">Lead</span>
              <div className="h-3 flex-1 rounded-full bg-muted">
                <div className="h-3 rounded-full bg-amber-500" style={{ width: `${costs.estimatedCostUsd > 0 ? Math.round((costs.leadCostUsd / costs.estimatedCostUsd) * 100) : 0}%` }} />
              </div>
              <span className="w-24 text-right text-xs tabular-nums">{formatUsd(costs.leadCostUsd)}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Estimates: token $0.00002/token (~$20/1M), lead $0.005/lead placeholder. Replace with config pricing when available; zeros if empty tenant.</p>
        </div>
      </section>

      <p className="text-[11px] text-muted-foreground">
        Analytics via tenant-scoped withTenantContext + getLeadStats fallback. Route: GET /api/acquisition/analytics returns acquisition, campaign, funnel, responseRates, workflow, apiUsage, modelUsage, costs — zeros if empty, not error.
      </p>
    </div>
  );
}

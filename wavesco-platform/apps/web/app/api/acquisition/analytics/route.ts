import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";

// Helper to safely count with fallback
async function safeCount(tx: any, model: string, where: any): Promise<number> {
  try {
    const m = tx[model];
    if (!m || typeof m.count !== "function") return 0;
    return await m.count({ where });
  } catch {
    return 0;
  }
}

export async function GET(_request?: Request) {
  // auth
  let tenantId: string;
  try {
    const auth = await requireControlAuth();
    const denied = await acquisitionDenied(auth.tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    tenantId = auth.tenantId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const digest = (e as any)?.digest as string | undefined;
    const isUnauthorized =
      msg === "UNAUTHORIZED" ||
      msg.includes("UNAUTHORIZED") ||
      msg.includes("NEXT_REDIRECT") ||
      (digest !== undefined && digest.includes("NEXT_REDIRECT"));
    if (isUnauthorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // acquisition — computed TENANT-SCOPED from LeadResearch / OutreachOrder
  // inside withTenantContext below. The shared Lead Engine corpus is
  // cross-tenant and must NEVER be presented as a tenant's acquisition data.
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

  // tenant-scoped aggregates
  let campaign: {
    total: number;
    eligible: number;
    sent: number;
    failed: number;
    pending: number;
    queued: number;
    reply: number;
  } = { total: 0, eligible: 0, sent: 0, failed: 0, pending: 0, queued: 0, reply: 0 };

  let funnel: {
    total: number;
    emailReady: number;
    contacted: number;
    replied: number;
    stages: { label: string; value: number; pct: number }[];
  } = {
    total: 0,
    emailReady: 0,
    contacted: 0,
    replied: 0,
    stages: [],
  };

  let responseRates: {
    replyRate: number;
    sentRate: number;
    raw: { replies: number; sent: number; eligible: number; contacted: number };
  } = {
    replyRate: 0,
    sentRate: 0,
    raw: { replies: 0, sent: 0, eligible: 0, contacted: 0 },
  };

  let workflow: {
    total: number;
    byType: Record<string, number>;
    byState: Record<string, number>;
    n8nExecutions: number | null;
    integrationStatusCount: number;
    recentEvents: number;
    note: string;
  } = {
    total: 0,
    byType: {},
    byState: {},
    n8nExecutions: null,
    integrationStatusCount: 0,
    recentEvents: 0,
      note: "Counts come from IntegrationStatus + ActivityEvent. n8n execution counts are not probed.",
  };

  let apiUsage: {
    totalEvents: number;
    integrationChecks: number;
    generationBatches: number;
    byType: Record<string, number>;
    followUpsPending: number;
  } = {
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
    byModel: {
      model: string;
      provider: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      avgLatency: number | null;
      count: number;
      estimatedCostUsd: number;
      success: number;
      failed: number;
    }[];
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

  let costs: {
    estimatedCostUsd: number;
    tokenCostUsd: number;
    leadCostUsd: number | null;
    perLeadCost: number | null;
    perTokenCost: number | null;
    breakdown: { tokenCost: number; leadCost: number | null; total: number };
  } = {
    estimatedCostUsd: 0,
    tokenCostUsd: 0,
    leadCostUsd: null,
    perLeadCost: null,
    perTokenCost: null,
    breakdown: { tokenCost: 0, leadCost: null, total: 0 },
  };

  let tenantDbError: string | null = null;

  try {
    const dbData = await withTenantContext(tenantId, async (tx: any) => {
      // campaigns
      const campaignTotal = await safeCount(tx, "campaign", { tenantId });

      // outreachEmail counts
      const outreachSent = await safeCount(tx, "outreachEmail", { tenantId, status: "sent" });
      const outreachFailed = await safeCount(tx, "outreachEmail", { tenantId, status: "failed" });
      const outreachQueued = await safeCount(tx, "outreachEmail", { tenantId, status: { in: ["submitted", "approved"] } });
      const outreachPending = await safeCount(tx, "outreachEmail", { tenantId, status: { in: ["draft", "submitted", "approved"] } });
      const outreachTotal = await safeCount(tx, "outreachEmail", { tenantId });

      // outreachOrder — handle replyStatus not null via multiple strategies
      let orderReplied = 0;
      let orderTotal = 0;
      try {
        orderTotal = await safeCount(tx, "outreachOrder", { tenantId });
      } catch {
        orderTotal = 0;
      }
      // try to count replied — use NOT null filter, fallback to findMany
      try {
        if (tx.outreachOrder && typeof tx.outreachOrder.count === "function") {
          // try Prisma not null syntax
          try {
            orderReplied = await tx.outreachOrder.count({ where: { tenantId, replyStatus: { not: null } } });
          } catch {
            try {
              orderReplied = await tx.outreachOrder.count({ where: { tenantId, NOT: { replyStatus: null } } });
            } catch {
              // findMany fallback
              if (typeof tx.outreachOrder.findMany === "function") {
                const rows = await tx.outreachOrder.findMany({ where: { tenantId }, take: 200 }).catch(() => []);
                orderReplied = (rows as any[]).filter((r) => r.replyStatus != null && String(r.replyStatus).trim() !== "").length;
              }
            }
          }
          // also catch replied where replyStatus is non-empty string and not 'none'
          // we already filtered null, but refine if rows available
          if (orderReplied === 0 && typeof tx.outreachOrder.findMany === "function") {
            try {
              const rows = await tx.outreachOrder.findMany({ where: { tenantId }, take: 200 });
              const filtered = (rows as any[]).filter(
                (r) => r.replyStatus != null && String(r.replyStatus).trim() !== "" && !["none", "no reply", "no"].includes(String(r.replyStatus).trim().toLowerCase())
              );
              if (filtered.length > 0) orderReplied = filtered.length;
            } catch {
              // ignore
            }
          }
        }
      } catch {
        orderReplied = 0;
      }

      // leadResearch totals for eligible fallback (if needed)
      // not strictly needed for campaign.eligible but we compute eligible as emailReady fallback
      // we don't need extra count, acquisition already has it

      // activity / workflow
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
        activityByType = {};
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
        integrationsByState = {};
      }

      // AiUsageLog
      let usageLogs: any[] = [];
      try {
        if (tx.aiUsageLog && typeof tx.aiUsageLog.findMany === "function") {
          usageLogs = await tx.aiUsageLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []);
        }
      } catch {
        usageLogs = [];
      }

      // generation batches
      const generationTotal = await safeCount(tx, "generationBatch", { tenantId });
      const followUpsPending = await safeCount(tx, "followUp", { tenantId, status: "pending" });

      // acquisition — TENANT-SCOPED only. Sourced from this tenant's
      // LeadResearch snapshots and OutreachOrder rows; never the shared corpus.
      const acqTotal = await safeCount(tx, "leadResearch", { tenantId });
      const acqEmailReady = await safeCount(tx, "leadResearch", {
        tenantId,
        email: { not: null },
      });
      const acqContacted = await safeCount(tx, "outreachOrder", { tenantId });
      const acqOptedOut = await safeCount(tx, "outreachOrder", {
        tenantId,
        replyStatus: "unsubscribed",
      });
      const acqBounced = await safeCount(tx, "outreachOrder", {
        tenantId,
        deliveryStatus: "bounced",
      });
      const byTier: Record<string, number> = {};
      try {
        const tiers = await tx.leadResearch.groupBy({
          by: ["tier"],
          where: { tenantId },
          _count: { _all: true },
        });
        for (const t of tiers as any[]) {
          byTier[String(t.tier ?? "unclassified")] = t._count?._all ?? 0;
        }
      } catch {
        // keep empty — never fabricate tier distribution
      }
      let lastResearchedAt: string | null = null;
      try {
        const last = await tx.leadResearch.findFirst({
          where: { tenantId },
          orderBy: { researchedAt: "desc" },
          select: { researchedAt: true },
        });
        lastResearchedAt = last?.researchedAt
          ? new Date(last.researchedAt).toISOString()
          : null;
      } catch {
        // keep null
      }

      return {
        campaignTotal,
        outreachSent,
        outreachFailed,
        outreachQueued,
        outreachPending,
        outreachTotal,
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
        acquisitionTenant: {
          total: acqTotal,
          emailReady: acqEmailReady,
          contacted: acqContacted,
          replies: orderReplied,
          optedOut: acqOptedOut,
          bounced: acqBounced,
          byTier,
          lastResearchedAt,
        },
      };
    });

    // tenant-scoped acquisition data (already computed inside the tenant tx)
    acquisition = dbData.acquisitionTenant;

    // build campaign
    const eligible = acquisition.emailReady; // eligible pool is emailReady from corpus
    campaign = {
      total: dbData.campaignTotal,
      eligible,
      sent: dbData.outreachSent,
      failed: dbData.outreachFailed,
      pending: dbData.outreachPending,
      queued: dbData.outreachQueued,
      reply: dbData.orderReplied,
    };

    // funnel
    const funnelTotal = acquisition.total;
    const funnelEmailReady = acquisition.emailReady;
    const funnelContacted = acquisition.contacted || dbData.outreachSent;
    // replied from acquisition or orderReplied (prefer max)
    const funnelReplied = Math.max(acquisition.replies, dbData.orderReplied);
    const stages = [
      { label: "Total", value: funnelTotal, pct: funnelTotal > 0 ? 100 : 0 },
      {
        label: "Email Ready",
        value: funnelEmailReady,
        pct: funnelTotal > 0 ? Math.round((funnelEmailReady / funnelTotal) * 100) : 0,
      },
      {
        label: "Contacted",
        value: funnelContacted,
        pct: funnelTotal > 0 ? Math.round((funnelContacted / funnelTotal) * 100) : 0,
      },
      {
        label: "Replied",
        value: funnelReplied,
        pct: funnelTotal > 0 ? Math.round((funnelReplied / funnelTotal) * 100) : 0,
      },
    ];

    funnel = {
      total: funnelTotal,
      emailReady: funnelEmailReady,
      contacted: funnelContacted,
      replied: funnelReplied,
      stages,
    };

    // response rates
    const replyRate = dbData.outreachSent > 0 ? funnelReplied / dbData.outreachSent : 0;
    const sentRate = eligible > 0 ? dbData.outreachSent / eligible : 0;
    responseRates = {
      replyRate,
      sentRate,
      raw: {
        replies: funnelReplied,
        sent: dbData.outreachSent,
        eligible,
        contacted: funnelContacted,
      },
    };

    // workflow
    workflow = {
      total: dbData.activityTotal + dbData.integrationCount,
      byType: dbData.activityByType,
      byState: dbData.integrationsByState,
      n8nExecutions: null,
      integrationStatusCount: dbData.integrationCount,
      recentEvents: dbData.recentEvents,
      note: "Counts come from IntegrationStatus + ActivityEvent. n8n execution counts are not probed.",
    };

    // apiUsage
    apiUsage = {
      totalEvents: dbData.activityTotal,
      integrationChecks: dbData.integrationCount,
      generationBatches: dbData.generationTotal,
      byType: dbData.activityByType,
      followUpsPending: dbData.followUpsPending,
    };

    // modelUsage aggregation
    const usageLogs = dbData.usageLogs as any[];
    let totalInput = 0;
    let totalOutput = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    let totalEstimatedCost = 0;
    const byModelMap = new Map<
      string,
      {
        model: string;
        provider: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        latencySum: number;
        latencyCount: number;
        count: number;
        estimatedCostUsd: number;
        success: number;
        failed: number;
      }
    >();

    for (const log of usageLogs) {
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

    // Only recorded spend is reported. Inventing a per-token rate produced
    // dollar figures that were pure arithmetic on a made-up number.
    const effectiveTokenCost = totalEstimatedCost;

    modelUsage = {
      totalTokens,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      avgLatency,
      count: usageLogs.length,
      byModel,
      totalEstimatedCostUsd: effectiveTokenCost,
    };

    // Costs: recorded token spend only. The per-lead rate is an internal
    // modelling constant, not a billed figure, so it is reported as null.
    const perLeadCost = null;
    const leadCostUsd = null;
    const tokenCostUsd = effectiveTokenCost;
    const estimatedCostUsd = tokenCostUsd;

    costs = {
      estimatedCostUsd,
      tokenCostUsd,
      leadCostUsd,
      perLeadCost,
      perTokenCost: null,
      breakdown: { tokenCost: tokenCostUsd, leadCost: null, total: estimatedCostUsd },
    };
  } catch (e) {
    tenantDbError = e instanceof Error ? e.message : String(e);
    // keep zeros — ensure not 500, just return zeros with error detail in meta
    // but acquisition already set, campaign/funnel etc stay zeroed
    // costs remain zero
    void tenantDbError;
  }

  return NextResponse.json(
    {
      acquisition,
      campaign,
      funnel,
      responseRates,
      workflow,
      apiUsage,
      modelUsage,
      costs,
      meta: {
        tenantId,
        generatedAt: new Date().toISOString(),
        ...(tenantDbError ? { dbWarning: tenantDbError.slice(0, 200) } : {}),
      },
    },
    { status: 200 }
  );
}

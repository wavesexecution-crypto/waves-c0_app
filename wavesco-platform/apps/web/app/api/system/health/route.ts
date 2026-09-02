import { NextResponse } from "next/server";
import { requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import { getIntegrationsHealth } from "@/lib/wavesco/integrations";

export const dynamic = "force-dynamic";

async function safeCount(tx: any, model: string, where: any): Promise<number> {
  try {
    const m = tx[model];
    if (!m || typeof m.count !== "function") return 0;
    return await m.count({ where });
  } catch {
    return 0;
  }
}

export async function GET(_req?: Request) {
  let tenantId: string;
  try {
    const auth = await requireControlAuth();
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

  // health via integrations (never leaks secrets, URLs masked)
  let health: {
    db: string;
    leadEngine: string;
    n8n: string;
    aiGateway: string;
    brevo: string;
    postgres: string;
    details: Record<string, unknown>;
  } = {
    db: "error",
    leadEngine: "BLOCKED",
    n8n: "BLOCKED",
    aiGateway: "BLOCKED",
    brevo: "BLOCKED",
    postgres: "error",
    details: {},
  };

  let healthMap: Record<string, any> | null = null;
  try {
    healthMap = await getIntegrationsHealth(tenantId);
    health = {
      db: (healthMap.db?.status as string) ?? (healthMap.postgres?.status as string) ?? "error",
      leadEngine: (healthMap.lead_engine?.status as string) ?? "BLOCKED",
      n8n: (healthMap.n8n?.status as string) ?? "BLOCKED",
      aiGateway: (healthMap.ai_gateway?.status as string) ?? "BLOCKED",
      brevo: (healthMap.brevo?.status as string) ?? "BLOCKED",
      postgres: (healthMap.postgres?.status as string) ?? (healthMap.db?.status as string) ?? "error",
      details: healthMap,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    health = {
      db: "error",
      leadEngine: "error",
      n8n: "BLOCKED",
      aiGateway: "BLOCKED",
      brevo: "BLOCKED",
      postgres: "error",
      details: { error: msg.slice(0, 300) },
    };
  }

  // tenant-scoped counts, audit logs, queue depth
  let auditLogs: unknown[] = [];
  let queueDepth = 0;
  let dbCounts: Record<string, number> = {
    campaigns: 0,
    outreachEmails: 0,
    outreachEmailPending: 0,
    outreachEmailFailed: 0,
    outreachOrders: 0,
    leadResearch: 0,
    generationBatches: 0,
    generationBatchesFailed: 0,
    followUpsPending: 0,
    followUps: 0,
    activityEvents: 0,
    auditLogs: 0,
    integrationStatus: 0,
    aiUsageLogs: 0,
    leadLifecycleEvents: 0,
  };

  let dbError: string | null = null;

  try {
    const data = await withTenantContext(tenantId, async (tx: any) => {
      const campaigns = await safeCount(tx, "campaign", { tenantId });
      const outreachEmails = await safeCount(tx, "outreachEmail", { tenantId });
      const outreachEmailPending = await safeCount(tx, "outreachEmail", {
        tenantId,
        status: { in: ["submitted", "approved", "pending", "queued"] },
      });
      const outreachEmailFailed = await safeCount(tx, "outreachEmail", { tenantId, status: "failed" });
      const outreachOrders = await safeCount(tx, "outreachOrder", { tenantId });
      const leadResearch = await safeCount(tx, "leadResearch", { tenantId });
      const generationBatches = await safeCount(tx, "generationBatch", { tenantId });
      const generationBatchesFailed = await safeCount(tx, "generationBatch", { tenantId, status: "failed" });
      const followUpsPending = await safeCount(tx, "followUp", { tenantId, status: "pending" });
      const followUps = await safeCount(tx, "followUp", { tenantId });
      const activityEvents = await safeCount(tx, "activityEvent", { tenantId });
      const auditLogsCount = await safeCount(tx, "auditLog", { tenantId });
      const integrationStatus = await safeCount(tx, "integrationStatus", { tenantId });
      const aiUsageLogs = await safeCount(tx, "aiUsageLog", { tenantId });
      const leadLifecycleEvents = await safeCount(tx, "leadLifecycleEvent", { tenantId });

      let recentAudit: unknown[] = [];
      try {
        if (tx.auditLog && typeof tx.auditLog.findMany === "function") {
          recentAudit = await tx.auditLog.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
            take: 10,
          });
        }
      } catch {
        recentAudit = [];
      }

      return {
        campaigns,
        outreachEmails,
        outreachEmailPending,
        outreachEmailFailed,
        outreachOrders,
        leadResearch,
        generationBatches,
        generationBatchesFailed,
        followUpsPending,
        followUps,
        activityEvents,
        auditLogsCount,
        integrationStatus,
        aiUsageLogs,
        leadLifecycleEvents,
        recentAudit,
      };
    });

    auditLogs = data.recentAudit;
    queueDepth = data.outreachEmailPending;
    dbCounts = {
      campaigns: data.campaigns,
      outreachEmails: data.outreachEmails,
      outreachEmailPending: data.outreachEmailPending,
      outreachEmailFailed: data.outreachEmailFailed,
      outreachOrders: data.outreachOrders,
      leadResearch: data.leadResearch,
      generationBatches: data.generationBatches,
      generationBatchesFailed: data.generationBatchesFailed,
      followUpsPending: data.followUpsPending,
      followUps: data.followUps,
      activityEvents: data.activityEvents,
      auditLogs: data.auditLogsCount,
      integrationStatus: data.integrationStatus,
      aiUsageLogs: data.aiUsageLogs,
      leadLifecycleEvents: data.leadLifecycleEvents,
    };
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
    try {
      const fallback = await withTenantContext(tenantId, async (tx: any) => {
        let recent: unknown[] = [];
        try {
          recent = await tx.auditLog.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
            take: 10,
          });
        } catch {
          recent = [];
        }
        return recent;
      });
      auditLogs = fallback as unknown[];
    } catch {
      auditLogs = [];
    }
  }

  const payload: Record<string, unknown> = {
    health,
    auditLogs,
    queueDepth,
    dbCounts,
    meta: {
      tenantId,
      generatedAt: new Date().toISOString(),
      ...(dbError ? { dbWarning: dbError.slice(0, 200) } : {}),
    },
  };

  // Also expose top-level health map for page convenience
  if (healthMap) {
    (payload as any).integrations = healthMap;
  }

  return NextResponse.json(payload, { status: 200 });
}

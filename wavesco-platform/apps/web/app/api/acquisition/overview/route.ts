import { NextResponse } from "next/server";
import { requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import { getLeadStats, getFacets, getLastEngineRun } from "@/lib/wavesco/lead-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { tenantId } = await requireControlAuth();

    // --- Corpus (Lead Engine) with fallback ---
    let corpus = {
      total: 0,
      emailReady: 0,
      contacted: 0,
      optedOut: 0,
      bounced: 0,
      replies: 0,
      byTier: {} as Record<string, number>,
      lastResearchedAt: null as string | null,
    };
    let facets = { categories: [] as string[], cities: [] as string[] };
    let lastRun: Awaited<ReturnType<typeof getLastEngineRun>> = null as unknown as Awaited<ReturnType<typeof getLastEngineRun>>;
    let leadEngine: { status: "ok" | "error"; detail: string } = { status: "ok", detail: "reachable" };

    try {
      const stats = await getLeadStats();
      corpus = {
        total: stats.total,
        emailReady: stats.emailReady,
        contacted: stats.contacted,
        optedOut: stats.optedOut,
        bounced: stats.bounced,
        replies: stats.replies,
        byTier: stats.byTier,
        lastResearchedAt: stats.lastResearchedAt,
      };
      try {
        facets = await getFacets();
      } catch (e) {
        facets = { categories: [], cities: [] };
        // keep leadEngine ok, but note facets failure in detail if needed
        void e;
      }
      try {
        lastRun = (await getLastEngineRun()) ?? null;
      } catch {
        lastRun = null;
      }
      leadEngine = { status: "ok", detail: facets.categories.length > 0 || facets.cities.length > 0 ? "corpus reachable" : "Lead Engine reachable" };
    } catch (e) {
      leadEngine = {
        status: "error",
        detail: e instanceof Error ? e.message : "Lead Engine unreachable",
      };
      // corpus stays zeroed, facets empty, lastRun null
      facets = { categories: [], cities: [] };
      lastRun = null;
    }

    // --- Platform counts + recent activity (tenant-scoped) ---
    let platform = { campaigns: 0, queued: 0, sent: 0, failed: 0, followUpsPending: 0 };
    let recentActivity: unknown[] = [];
    let db: { status: "ok" | "error"; detail: string } = { status: "ok", detail: "connected" };

    try {
      const result = await withTenantContext(tenantId, async (tx: any) => {
        const campaigns = await tx.campaign.count({ where: { tenantId } });
        const queued = await tx.outreachEmail.count({
          where: { tenantId, status: { in: ["submitted", "approved"] } },
        });
        const sent = await tx.outreachEmail.count({ where: { tenantId, status: "sent" } });
        const failed = await tx.outreachEmail.count({ where: { tenantId, status: "failed" } });
        const followUpsPending = await tx.followUp.count({ where: { tenantId, status: "pending" } });
        const activity = await tx.activityEvent.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 5,
        });
        return { campaigns, queued, sent, failed, followUpsPending, activity };
      });
      platform = {
        campaigns: result.campaigns,
        queued: result.queued,
        sent: result.sent,
        failed: result.failed,
        followUpsPending: result.followUpsPending,
      };
      recentActivity = result.activity;
    } catch (e) {
      db = { status: "error", detail: e instanceof Error ? e.message : "db error" };
      // platform stays zeroed, recentActivity empty
    }

    // --- System health: n8n (presence check, no secret leak) ---
    const n8nBase = (process.env.N8N_BASE_URL ?? "").trim();
    let n8n: { status: "ok" | "missing" | "error"; detail: string };
    if (!n8nBase) {
      n8n = { status: "missing", detail: "N8N_BASE_URL not configured" };
    } else {
      n8n = { status: "ok", detail: "n8n configured" };
    }

    const system = { leadEngine, db, n8n };

    return NextResponse.json({
      corpus,
      platform,
      system,
      facets,
      lastRun,
      recentActivity,
      alerts: [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const digest = (e as any)?.digest as string | undefined;
    const isUnauthorized =
      msg === "UNAUTHORIZED" ||
      msg.includes("UNAUTHORIZED") ||
      msg.includes("NEXT_REDIRECT") ||
      (digest && digest.includes("NEXT_REDIRECT"));
    if (isUnauthorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}

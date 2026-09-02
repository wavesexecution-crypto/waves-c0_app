import { NextResponse } from "next/server";
import { requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import { buildAgentContext } from "@/lib/wavesco/acquisition-profile";
import { getIntegrationsHealth } from "@/lib/wavesco/integrations";

export const dynamic = "force-dynamic";

function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const digest = (e as any)?.digest as string | undefined;
  return msg === "UNAUTHORIZED" || msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT") || !!(digest && digest.includes("NEXT_REDIRECT"));
}

// GET — structured Nemotron context, masked, tenant-scoped
export async function GET() {
  try {
    const { tenantId } = await requireControlAuth();

    const profile = await withTenantContext(tenantId, async (tx: any) => {
      const p = await (tx as any).acquisitionProfile.findFirst({ where: { tenantId } });
      return p;
    });

    // Best-effort historical context (never leak secrets)
    let integrationsHealth: unknown = null;
    try {
      integrationsHealth = await getIntegrationsHealth(tenantId);
    } catch {}

    let campaignsSummary: unknown = null;
    let leadStats: unknown = null;
    let activityEvents: unknown = null;
    try {
      const ctx = await withTenantContext(tenantId, async (tx: any) => {
        const campaigns = await tx.campaign.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, status: true, createdAt: true } });
        const outreach = await tx.outreachOrder.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, businessName: true, email: true, status: true } });
        const activity = await tx.activityEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 5 });
        // lead stats via direct counts (avoid lead-engine dependency for context)
        const leadCount = await tx.leadResearch.count({ where: { tenantId } });
        const outreachCount = await tx.outreachOrder.count({ where: { tenantId } });
        return { campaigns, outreach, activity, leadCount, outreachCount };
      });
      campaignsSummary = (ctx as any).campaigns;
      leadStats = { total: (ctx as any).leadCount, outreachTotal: (ctx as any).outreachCount };
      activityEvents = (ctx as any).activity;
    } catch {}

    const context = await buildAgentContext(tenantId, profile as any, {
      integrationsHealth,
      campaignsSummary,
      leadStats,
      outreachHistory: null,
      activityEvents,
    });

    return NextResponse.json({ context, profile, generatedAt: new Date().toISOString() });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}

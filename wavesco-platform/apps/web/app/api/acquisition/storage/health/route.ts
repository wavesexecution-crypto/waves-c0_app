import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import { storageDescribe, storagePing, wavesStorageConfig } from "@/lib/wavesco/object-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/acquisition/storage/health — Waves-held storage truth:
 *  provider, location (no secrets), live capability probe, and registry
 *  counters. Distinguishes ok / degraded / unavailable explicitly. */
export async function GET() {
  try {
    const { tenantId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });

    const resolved = wavesStorageConfig();
    if ("error" in resolved) {
      return NextResponse.json(
        { state: "unavailable", provider: null, reason: resolved.error, counts: null },
        { status: 200 },
      );
    }
    const ping = await storagePing(resolved.config);
    let counts: Record<string, number> | null = null;
    try {
      counts = await withTenantContext(tenantId, async (tx) => {
        const rows = await tx.storedObject.groupBy({ by: ["status"], where: { tenantId }, _count: true });
        return Object.fromEntries(rows.map((r: { status: string; _count: number }) => [r.status, r._count]));
      });
    } catch {
      counts = null;
    }
    return NextResponse.json(
      {
        state: ping.ok ? "ok" : "degraded",
        provider: ping.provider,
        location: storageDescribe(resolved.config).location,
        detail: ping.detail,
        latencyMs: ping.latencyMs,
        counts,
        checkedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

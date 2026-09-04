/**
 * POST /api/internal/reconcile
 *
 * REAL server-side reconciliation entry point (no frontend polling):
 *   - Session-authenticated requests reconcile the caller's tenant.
 *   - Internal-key requests (x-reconcile-key: INTERNAL_RECONCILE_KEY) may
 *     reconcile one tenant (?tenantId=…) or ALL tenants (default) — designed
 *     for n8n scheduled triggers / cron.
 *
 * Idempotent and concurrency-safe by construction (deterministic dedup keys,
 * status-guarded updates downstream). Never fabricates success: per-step
 * errors are returned truthfully.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withTenantContext } from "@wavesco/db";
import { runAcquisitionReconciliation } from "@/lib/wavesco/reconcile";

export const dynamic = "force-dynamic";

async function allTenantIds(): Promise<string[]> {
  return withTenantContext("system", async () => {
    const rows = await (await import("@wavesco/db")).prisma.outreachOrder.findMany({
      distinct: ["tenantId"],
      select: { tenantId: true },
    });
    return rows.map((r) => r.tenantId);
  });
}

export async function POST(request: Request) {
  const internalKey = process.env.INTERNAL_RECONCILE_KEY?.trim() ?? "";
  const providedKey = request.headers.get("x-reconcile-key")?.trim() ?? "";

  if (providedKey) {
    if (!internalKey) {
      return NextResponse.json(
        { ok: false, error: "Internal reconcile key is not configured." },
        { status: 503 },
      );
    }
    if (providedKey !== internalKey) {
      return NextResponse.json({ ok: false, error: "Invalid reconcile key." }, { status: 401 });
    }
    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenantId");
    const tenants = tenantId ? [tenantId] : await allTenantIds();
    const results = [];
    let ok = true;
    for (const t of tenants) {
      const r = await runAcquisitionReconciliation(t);
      ok = ok && r.ok;
      results.push({ tenantId: t, ...r });
    }
    return NextResponse.json({ ok, tenants: results.length, results }, { status: ok ? 200 : 207 });
  }

  // Session path — tenant from the authenticated session only.
  const session = await auth();
  const tenantId =
    (session as unknown as { user?: { tenantId?: string } | null } | null)?.user?.tenantId ?? null;
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const result = await runAcquisitionReconciliation(tenantId);
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}

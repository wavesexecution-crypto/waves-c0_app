/**
 * POST/GET /api/acquisition/reconcile — REAL lifecycle reconciliation entry
 * point for server-side schedulers (n8n) and internal operators.
 *
 * Auth (both modes fail closed):
 *  1. SCHEDULER: header `x-reconcile-key` == env ACQUISITION_RECONCILE_KEY
 *     (timing-safe compare). Reconciles EVERY tenant and reports per-tenant
 *     results truthfully. If the env key is not configured, this mode is
 *     disabled — never accepted by default.
 *  2. SESSION: owner/admin session reconciles only their own tenant.
 *
 * The reconciliation itself is idempotent (deterministic dedup keys,
 * status-guarded updates), so overlapping scheduler runs are safe.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { prisma, withTenantContext } from "@wavesco/db";
import { runAcquisitionReconciliation } from "@/lib/wavesco/reconcile";

export const dynamic = "force-dynamic";

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function handle(req: Request): Promise<NextResponse> {
  const schedulerKey = process.env.ACQUISITION_RECONCILE_KEY?.trim() ?? "";
  const providedKey = req.headers.get("x-reconcile-key") ?? req.headers.get("x-reconcile-token");

  if (providedKey) {
    if (!schedulerKey) {
      return NextResponse.json(
        { ok: false, error: "Scheduler key auth is not configured on this deployment." },
        { status: 503 },
      );
    }
    if (!timingSafeEqualStr(providedKey, schedulerKey)) {
      return NextResponse.json({ ok: false, error: "Invalid key." }, { status: 401 });
    }

    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    const results: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    for (const t of tenants) {
      try {
        const r = await runAcquisitionReconciliation(t.id);
        results.push({ tenantId: t.id, ...r });
        if (!r.ok) errors.push(`${t.id}: ${r.errors.join("; ")}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${t.id}: ${msg}`);
        results.push({ tenantId: t.id, ok: false, errors: [msg] });
      }
    }
    console.log(
      JSON.stringify({
        event: "acquisition.reconciliation.scheduled",
        tenants: tenants.length,
        failures: errors.length,
      }),
    );
    return NextResponse.json({ ok: errors.length === 0, tenants: results.length, results, errors });
  }

  // Session mode: an owner/admin can reconcile their own tenant manually.
  const session = await auth();
  const user = (session as { user?: { tenantId?: string; role?: string } } | null)?.user;
  if (!user?.tenantId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "owner" && user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const r = await runAcquisitionReconciliation(user.tenantId);
  return NextResponse.json(r, { status: r.ok ? 200 : 207 });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    return await handle(req);
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "acquisition.reconciliation.route_error",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  return POST(req);
}

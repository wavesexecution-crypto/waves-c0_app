import { NextResponse } from "next/server";
import crypto from "crypto";
import { expireDueEntitlements } from "@/lib/wavesco/entitlements";
import { runAcquisitionReconciliation } from "@/lib/wavesco/reconcile";
import { directPrisma } from "@wavesco/db";

export const dynamic = "force-dynamic";

/** GET /api/cron/reconcile — scheduled worker entry point (Vercel Cron).
 *
 *  Runs automatically on `CRON_SECRET` bearer auth:
 *    1. Expiry sweep (TRIAL/ACTIVE past expiry → EXPIRED, audited).
 *    2. Per-tenant reconciliation (replies, bounces, delivery, follow-ups).
 *
 *  Idempotent: overlapping runs are safe (status-guarded updates,
 *  deterministic dedup keys). One bad tenant never stops the sweep —
 *  failures are recorded per tenant and reported truthfully. */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET?.trim() ?? "";
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Scheduler is not configured on this deployment (CRON_SECRET missing)." },
      { status: 503 },
    );
  }
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: "Invalid scheduler credentials." }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  let expiry: { checked: number; expired: number };
  try {
    expiry = await expireDueEntitlements();
  } catch (e) {
    expiry = { checked: 0, expired: 0 };
    return NextResponse.json(
      { ok: false, error: `Expiry sweep failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  let tenants: { id: string }[] = [];
  try {
    // Owner-role read: the runtime role has no tenant context on this path,
    // so an RLS-bound query would silently return zero tenants.
    tenants = await directPrisma().tenant.findMany({ select: { id: true } });
  } catch (e) {
    return NextResponse.json(
      { ok: true, startedAt, expiry, tenants: 0, warning: `Tenant list failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 200 },
    );
  }

  const results: Array<Record<string, unknown>> = [];
  for (const t of tenants) {
    try {
      const r = await runAcquisitionReconciliation(t.id);
      // Storage sweep (additive): detect archived bytes that went missing.
      // Never fails the tenant's reconciliation — reported separately.
      let storage: unknown = null;
      try {
        const { reconcileStorage } = await import("@/lib/wavesco/artifacts");
        storage = await reconcileStorage(t.id);
      } catch (e) {
        storage = { error: e instanceof Error ? e.message : String(e) };
      }
      results.push({ tenantId: t.id.slice(0, 8) + "…", reconciled: r.ok, detail: r, storage });
    } catch (e) {
      results.push({ tenantId: t.id.slice(0, 8) + "…", reconciled: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const failed = results.filter((r) => !r.reconciled).length;
  return NextResponse.json(
    { ok: failed === 0, startedAt, finishedAt: new Date().toISOString(), expiry, tenants: tenants.length, failed, results },
    { status: 200 },
  );
}

import { NextResponse } from "next/server";
import { requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { activatePaid, hasAccess } from "@/lib/wavesco/entitlements";
import { leaseInfo, isValidLeaseType } from "@/lib/wavesco/pricing";
import {
  OPERATOR_DENIED_REASON,
  OPERATOR_KEY_HEADER,
  isOperatorRequest,
} from "@/lib/wavesco/operator-gate";

export const dynamic = "force-dynamic";

/**
 * POST /api/acquisition/entitlement/activate — operator-only off-band grant.
 *
 * SECURITY: the tenant's own `owner` role is NOT sufficient. Previously any
 * workspace owner could POST this route with `{days: 732}` and receive paid
 * Acquisition OS access for nothing, with a self-documenting ledger row. The
 * route now requires the operator key.
 *
 * PRICING: the duration and amount are DERIVED SERVER-SIDE from the locked
 * table in `pricing.ts`. `days`, `expiresAt` and `amountPaise` supplied by the
 * caller are ignored entirely — only `leaseType` selects the price.
 *
 * Payment-originated activation does not use this route; it goes through
 * `activatePaid` from the Razorpay verify/webhook handlers, which re-check the
 * captured amount.
 *
 * Deliberately NOT entitlement-gated: expired tenants are renewed from here.
 */
export async function POST(req: Request) {
  let tenantId: string;
  let userId: string | null | undefined;
  let role: string;
  try {
    const auth = await requireControlAuth();
    tenantId = auth.tenantId;
    userId = auth.userId;
    role = sessionRole(auth.session);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Role gate AND operator key are both required. `role === "owner"` only
  // means "owner of my workspace" — it is not an operator credential.
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", reason: "Owner role required to record paid access." },
      { status: 403 },
    );
  }

  if (!isOperatorRequest(req.headers.get(OPERATOR_KEY_HEADER))) {
    return NextResponse.json(
      {
        error: "forbidden",
        reason: OPERATOR_DENIED_REASON,
        whatNext: "Extend or renew from Billing. Payment is verified there.",
      },
      { status: 403 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Only the lease TYPE may come from the caller. Everything else is derived.
  if (!isValidLeaseType(body.leaseType)) {
    return NextResponse.json(
      { error: "invalid_lease_type", reason: "leaseType must be one of LEASE_30, LEASE_90, LEASE_180, LEASE_365." },
      { status: 400 },
    );
  }
  const lease = leaseInfo(body.leaseType);

  try {
    const { entitlement } = await activatePaid(
      tenantId,
      {
        provider: typeof body.provider === "string" ? body.provider : "manual",
        providerRef: typeof body.providerRef === "string" ? body.providerRef : undefined,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
        // Server-derived, never client-supplied.
        days: lease.days,
        amountPaise: lease.paise,
        currency: "INR",
        note: typeof body.note === "string" ? body.note : undefined,
      },
      userId,
    );
    return NextResponse.json({ ok: true, entitlement, hasAccess: hasAccess(entitlement.status) }, { status: 200 });
  } catch (e) {
    console.error("[entitlement:activate] operator grant failed", e);
    return NextResponse.json(
      { error: "activation_failed", reason: "We could not record this access grant." },
      { status: 400 },
    );
  }
}

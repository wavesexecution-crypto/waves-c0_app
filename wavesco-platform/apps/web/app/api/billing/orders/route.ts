import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { withTenantContext } from "@wavesco/db";
import { requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { isValidLeaseType, leaseInfo, VALID_LEASE_TYPES } from "@/lib/wavesco/pricing";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  razorpayKeyId,
} from "@/lib/razorpay";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/orders — start a Razorpay checkout for an Acquisition OS
 * lease.
 *
 * The amount and duration are locked SERVER-SIDE from LEASE_PRICES: the
 * client only supplies `leaseType` (+ optional idempotency key). The ledger
 * row (AcquisitionOrder, status PENDING, provider=razorpay) is written
 * through withTenantContext (RLS-scoped + audited) BEFORE the Razorpay order
 * is created, so a Razorpay failure leaves no orphan row.
 *
 * Response exposes ONLY the public Razorpay key id — never the secret.
 */
export async function POST(req: Request) {
  let auth: { session: unknown; tenantId: string; userId: string | null };
  try {
    auth = await requireControlAuth();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = sessionRole(auth.session);
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", reason: "Owner or admin role required to lease Acquisition OS." },
      { status: 403 },
    );
  }
  if (!isRazorpayConfigured()) {
    return NextResponse.json({ error: "payment_provider_not_configured" }, { status: 503 });
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!isValidLeaseType(body.leaseType)) {
    return NextResponse.json(
      { error: "invalid_lease_type", valid: VALID_LEASE_TYPES },
      { status: 400 },
    );
  }
  const lease = leaseInfo(body.leaseType);

  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 120)
      : `rzp:${randomUUID()}`;

  try {
    // 1) Create Razorpay order first so providerRef is stable, then the
    //    ledger row (RLS-scoped). If the DB insert fails afterwards we leave
    //    an unpaid Razorpay order (which expires) but no orphan ledger row.
    const razorpayOrder = await createRazorpayOrder({
      amountPaise: lease.paise,
      currency: "INR",
      receipt: `ao-${auth.tenantId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20)}`,
      notes: { tenantId: auth.tenantId, leaseType: lease.leaseType, product: "acquisition-os" },
    });

    const row = await withTenantContext(
      auth.tenantId,
      async (tx) => {
        const order = await tx.acquisitionOrder.create({
          data: {
            tenantId: auth.tenantId,
            status: "PENDING",
            provider: "razorpay",
            providerRef: razorpayOrder.id,
            idempotencyKey,
            amountPaise: lease.paise,
            currency: "INR",
            meta: {
              razorpayOrderId: razorpayOrder.id,
              leaseType: lease.leaseType,
              days: lease.days,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: auth.tenantId,
            userId: auth.userId,
            action: "billing.order.create",
            model: "AcquisitionOrder",
            recordId: order.id,
            after: {
              provider: "razorpay",
              razorpayOrderId: razorpayOrder.id,
              leaseType: lease.leaseType,
              amountPaise: lease.paise,
              currency: "INR",
              days: lease.days,
            },
          },
        });
        return order;
      },
      auth.userId ?? undefined,
    );

    return NextResponse.json(
      {
        ok: true,
        orderId: row.id,
        razorpayOrderId: razorpayOrder.id,
        amountPaise: lease.paise,
        currency: "INR",
        days: lease.days,
        leaseType: lease.leaseType,
        keyId: razorpayKeyId(),
      },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: "order_creation_failed",
        reason: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
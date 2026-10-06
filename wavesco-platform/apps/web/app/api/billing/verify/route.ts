import { NextResponse } from "next/server";
import { withTenantContext } from "@wavesco/db";
import { requireControlAuth } from "@/lib/wavesco/control";
import { verifyClientSignature, fetchRazorpayPayment } from "@/lib/razorpay";
import { activatePaid, getAcquisitionOSEntitlement, hasAccess } from "@/lib/wavesco/entitlements";
import { annotateOrder, leaseDaysFromMeta, orderMeta } from "@/lib/wavesco/billing";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/verify — confirm a completed Razorpay Checkout and
 * activate the lease.
 *
 * Pipeline (server-side, in order):
 *   1. HMAC-SHA256 check over `${razorpayOrderId}|${razorpayPaymentId}` using
 *      the KEY SECRET (client-callback scheme — only the server knows it).
 *   2. Load the AcquisitionOrder by providerRef = Razorpay order id INSIDE
 *      the caller's RLS tenant scope — wrong tenant/wrong order ⇒ 404 here.
 *   3. Re-fetch the payment from Razorpay and require: it belongs to this
 *      order, is `captured`, and amount+currency match the locked price.
 *   4. Activate via `activatePaid` — the SINGLE canonical state machine
 *      (idempotent by idempotencyKey; replay returns the existing grant).
 *   5. Annotate the ledger row (paymentId/signature) + audit `billing.verify`.
 */
export async function POST(req: Request) {
  let auth: { session: unknown; tenantId: string; userId: string | null };
  try {
    auth = await requireControlAuth();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const razorpayOrderId = typeof body.razorpayOrderId === "string" ? body.razorpayOrderId.trim() : "";
  const paymentId = typeof body.razorpayPaymentId === "string" ? body.razorpayPaymentId.trim() : "";
  const signature = typeof body.razorpaySignature === "string" ? body.razorpaySignature.trim() : "";
  if (!razorpayOrderId || !paymentId || !signature) {
    return NextResponse.json({ error: "missing_parameters" }, { status: 400 });
  }

  // 1) Signature — reject forged callbacks before touching the ledger.
  if (!verifyClientSignature(razorpayOrderId, paymentId, signature)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // 2) Order must exist for THIS tenant. RLS hides other tenants' rows, so a
  //    cross-tenant attempt yields the same 404 as an unknown order. The
  //    tenant predicate is explicit too: with a table-owner connection (where
  //    ENABLE RLS does not apply) a predicate-less lookup would return another
  //    tenant's order.
  const order = await withTenantContext(auth.tenantId, async (tx) =>
    tx.acquisitionOrder.findFirst({ where: { providerRef: razorpayOrderId, tenantId: auth.tenantId } }),
  );
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  // 2b) Idempotent replay: the grant already exists for this order.
  const meta = orderMeta(order);
  if (order.status === "VERIFIED") {
    const entitlement = await getAcquisitionOSEntitlement(auth.tenantId);
    return NextResponse.json(
      { ok: true, alreadyVerified: true, entitlement, hasAccess: hasAccess(entitlement.status) },
      { status: 200 },
    );
  }

  // 3) Confirm the payment with Razorpay itself.
  let payment;
  try {
    payment = await fetchRazorpayPayment(paymentId);
  } catch (e) {
    return NextResponse.json(
      { error: "payment_lookup_failed", reason: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
  if (payment.order_id !== razorpayOrderId) {
    return NextResponse.json({ error: "order_mismatch" }, { status: 400 });
  }
  if (payment.status !== "captured") {
    return NextResponse.json(
      { error: "payment_not_captured", status: payment.status ?? "unknown" },
      { status: 400 },
    );
  }
  if (payment.amount !== order.amountPaise || payment.currency !== order.currency) {
    return NextResponse.json({ error: "amount_mismatch" }, { status: 400 });
  }

  // 4) Activation through the single canonical state machine.
  const days = leaseDaysFromMeta(order.meta);
  if (!days) {
    return NextResponse.json({ error: "order_invalid_lease" }, { status: 500 });
  }
  const { entitlement } = await activatePaid(
    auth.tenantId,
    {
      provider: "razorpay",
      providerRef: paymentId,
      idempotencyKey: order.idempotencyKey,
      days,
      amountPaise: order.amountPaise ?? undefined,
      currency: order.currency,
      note: `Razorpay order ${razorpayOrderId}`,
    },
    auth.userId,
  );

  // 5) Annotate the ledger + audit (skip when a concurrent request already did).
  if (!meta.paymentId) {
    await annotateOrder({
      tenantId: auth.tenantId,
      orderId: order.id,
      patch: {
        paymentId,
        razorpayOrderId,
        signature,
        verifiedAt: new Date().toISOString(),
      },
      auditAction: "billing.verify",
      after: { razorpayOrderId, paymentId },
      userId: auth.userId,
    });
  }

  return NextResponse.json(
    { ok: true, entitlement, hasAccess: hasAccess(entitlement.status) },
    { status: 200 },
  );
}
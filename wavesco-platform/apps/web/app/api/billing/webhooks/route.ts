import { NextResponse } from "next/server";
import { withTenantContext } from "@wavesco/db";
import { isWebhookConfigured, verifyWebhookSignature } from "@/lib/razorpay";
import { activatePaid, transitionEntitlement } from "@/lib/wavesco/entitlements";
import { annotateOrder, findOrderCrossTenant, leaseDaysFromMeta } from "@/lib/wavesco/billing";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhooks — Razorpay event delivery.
 *
 * Reliability layer for the checkout flow (async payment methods, network
 * drops after payment, refunds). NOT a second state machine: every activation
 * funnels into the same `activatePaid` used by the client verify route, so
 * verify + webhook are idempotent and cannot conflict.
 *
 * - Authorization: `X-Razorpay-Signature` = HMAC-SHA256(raw body, webhook
 *   secret). The webhook secret is a DIFFERENT secret from the key secret,
 *   configured server-side only (RAZORPAY_WEBHOOK_SECRET).
 * - Cross-tenant order resolution uses the owner-role direct client (RLS
 *   would hide all rows without a tenant context); all mutations still run
 *   inside withTenantContext so RLS + audit apply.
 * - Verify + webhook may both fire for the same payment — both are
 *   idempotent, so the second is a no-op returning the existing state.
 *
 * Events handled: payment.captured, payment.failed, refund.processed /
 * refunded. Unknown events → 200 (ignore). Any processing error → 500
 * (Razorpay retries; our idempotency makes retries safe).
 */
export async function POST(req: Request) {
  if (!isWebhookConfigured()) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  if (!signature || !verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const event = typeof payload.event === "string" ? payload.event : "";
  const entity = payload.payload as
    | { payment?: { entity?: Record<string, unknown> }; refund?: { entity?: Record<string, unknown> } }
    | undefined;
  const payment = (entity?.payment?.entity ?? {}) as Record<string, unknown>;
  const refund = (entity?.refund?.entity ?? {}) as Record<string, unknown>;

  try {
    switch (event) {
      case "payment.captured":
        return await handleCaptured(payment);
      case "payment.failed":
        return await handleFailed(payment);
      case "refund.processed":
      case "refund.processed.v2":
      case "refunded":
        return await handleRefund(payment, refund);
      default:
        return NextResponse.json({ ok: true, ignored: event }, { status: 200 });
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: "webhook_processing_failed",
        reason: e instanceof Error ? e.message : String(e),
        shouldRetry: true,
      },
      { status: 500 },
    );
  }
}

async function handleCaptured(payment: Record<string, unknown>) {
  const orderId = typeof payment.order_id === "string" ? payment.order_id : "";
  const payId = typeof payment.id === "string" ? payment.id : "";
  if (!orderId || !payId) {
    return NextResponse.json({ error: "missing payment fields" }, { status: 400 });
  }

  const order = await findOrderCrossTenant([orderId]);
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

  // Idempotency: activation already completed for this payment.
  if (order.status === "VERIFIED" && order.meta.paymentId === payId) {
    return NextResponse.json({ ok: true, alreadyVerified: true, orderId: order.id }, { status: 200 });
  }

  const days = leaseDaysFromMeta(order.meta);
  if (!days) {
    // Never invent pricing for an order we can't map to the commercial model.
    await annotateOrder({
      tenantId: order.tenantId,
      orderId: order.id,
      patch: { paymentId: payId, capturedAt: new Date().toISOString() },
      auditAction: "billing.webhook.captured.no_lease",
      after: { paymentId: payId, reason: "order meta missing leaseType — manual action required" },
    });
    return NextResponse.json({ ok: true, note: "order has no lease mapping — flagged for review" }, { status: 200 });
  }

  await activatePaid(
    order.tenantId,
    {
      provider: "razorpay",
      providerRef: payId,
      idempotencyKey: order.idempotencyKey,
      days,
      amountPaise: order.amountPaise ?? undefined,
      currency: order.currency,
      note: `Razorpay captured (webhook) ${payId}`,
    },
    null,
  );

  await annotateOrder({
    tenantId: order.tenantId,
    orderId: order.id,
    patch: { paymentId: payId, capturedAt: new Date().toISOString() },
    auditAction: "billing.webhook.captured",
    after: { paymentId: payId, razorpayOrderId: orderId },
  });

  return NextResponse.json({ ok: true, orderId: order.id, tenantId: order.tenantId }, { status: 200 });
}

async function handleFailed(payment: Record<string, unknown>) {
  const orderId = typeof payment.order_id === "string" ? payment.order_id : "";
  const payId = typeof payment.id === "string" ? payment.id : "";
  if (!orderId) return NextResponse.json({ error: "missing order id" }, { status: 400 });

  const order = await findOrderCrossTenant([orderId]);
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  if (order.status !== "PENDING") {
    return NextResponse.json({ ok: true, ignored: `status ${order.status}` }, { status: 200 });
  }

  await withTenantContext(order.tenantId, async (tx) => {
    await tx.acquisitionOrder.update({
      where: { id: order.id },
      data: {
        status: "FAILED",
        meta: {
          ...order.meta,
          paymentId: payId || null,
          failedAt: new Date().toISOString(),
          failureReason:
            typeof payment.error_description === "string" ? payment.error_description : null,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: order.tenantId,
        action: "billing.order.failed",
        model: "AcquisitionOrder",
        recordId: order.id,
        after: { razorpayOrderId: orderId, paymentId: payId || null },
      },
    });
  });

  return NextResponse.json({ ok: true, orderId: order.id }, { status: 200 });
}

async function handleRefund(
  payment: Record<string, unknown>,
  refund: Record<string, unknown>,
) {
  const paymentId = (typeof refund.payment_id === "string" ? refund.payment_id : "") ||
    (typeof payment.id === "string" ? payment.id : "");
  const refundId = typeof refund.id === "string" ? refund.id : null;

  const order = await findOrderCrossTenant([
    paymentId,
    typeof payment.order_id === "string" ? payment.order_id : null,
    typeof refund.id === "string" ? refund.id : null,
  ]);
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

  if (order.status !== "VERIFIED") {
    return NextResponse.json({ ok: true, ignored: `status ${order.status}` }, { status: 200 });
  }

  // 1) Mark the ledger row REFUNDED (append-only audit).
  await withTenantContext(order.tenantId, async (tx) => {
    await tx.acquisitionOrder.update({
      where: { id: order.id },
      data: {
        status: "REFUNDED",
        meta: { ...order.meta, refundId, refundedAt: new Date().toISOString() },
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: order.tenantId,
        action: "billing.order.refunded",
        model: "AcquisitionOrder",
        recordId: order.id,
        after: { paymentId, refundId },
      },
    });
  });

  // 2) If this order is the current ACTIVE grant, revoke access via the
  //    canonical transition (refund is terminal). If the tenant renewed on a
  //    later order, the refund only touches the ledger/audit for this order.
  const ent = await withTenantContext(order.tenantId, async (tx) =>
    tx.acquisitionEntitlement.findUnique({ where: { tenantId: order.tenantId } }),
  );
  if (ent && ent.orderId === order.id && ent.status === "ACTIVE") {
    try {
      await transitionEntitlement(
        order.tenantId,
        "refund",
        { reason: `Razorpay refund ${refundId ?? paymentId}` },
        null,
      );
    } catch {
      // Already terminal (REFUNDED/CANCELLED) — nothing to revoke.
    }
  }

  return NextResponse.json({ ok: true, orderId: order.id }, { status: 200 });
}
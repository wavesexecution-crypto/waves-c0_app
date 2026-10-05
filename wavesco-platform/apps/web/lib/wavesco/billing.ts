import { withTenantContext } from "@wavesco/db";
import { isValidLeaseType, leaseInfo } from "./pricing";

/**
 * Shared helpers for the Razorpay billing flow (orders → verify → webhook).
 *
 * Everything here goes through the SAME single activation state machine
 * (`activatePaid` in entitlements.ts) — no second/competing payment-state
 * machine exists. These helpers only map order metadata → lease length and
 * annotate the AcquisitionOrder ledger row + audit trail after a payment
 * event is confirmed.
 */

export interface OrderMeta {
  razorpayOrderId?: string;
  leaseType?: string;
  days?: number;
  paymentId?: string;
  signature?: string;
  verifiedAt?: string;
  failedAt?: string;
  refundId?: string;
  refundedAt?: string;
  [key: string]: unknown;
}

export function orderMeta(order: { meta?: unknown }): OrderMeta {
  return (order?.meta ?? {}) as OrderMeta;
}

/** Server-locked days for an order's lease type. NULL if the order has no
 *  valid lease type (should never happen — orders are created server-side). */
export function leaseDaysFromMeta(meta: unknown): number | null {
  const m = (meta ?? {}) as OrderMeta;
  if (typeof m.leaseType === "string" && isValidLeaseType(m.leaseType)) {
    return leaseInfo(m.leaseType).days;
  }
  return null;
}

/** Annotate the ledger row and write an audit entry atomically (RLS-scoped). */
export async function annotateOrder(args: {
  tenantId: string;
  orderId: string;
  patch: Record<string, unknown>;
  auditAction: string;
  after?: Record<string, unknown>;
  userId?: string | null;
}): Promise<void> {
  await withTenantContext(
    args.tenantId,
    async (tx) => {
      const current = await tx.acquisitionOrder.findUnique({ where: { id: args.orderId } });
      if (!current) throw new Error("order_not_found");
      const meta: OrderMeta = { ...orderMeta(current), ...args.patch };
      await tx.acquisitionOrder.update({ where: { id: args.orderId }, data: { meta } });
      await tx.auditLog.create({
        data: {
          tenantId: args.tenantId,
          userId: args.userId ?? null,
          action: args.auditAction,
          model: "AcquisitionOrder",
          recordId: args.orderId,
          after: { ...(args.after ?? {}), meta },
        },
      });
    },
    args.userId ?? undefined,
  );
}

/** Cross-tenant ledger lookup for webhooks (owner client, bypasses RLS —
 *  webhooks arrive without a tenant session). Used ONLY to resolve an order
 *  to its tenant; all mutations still run RLS-scoped via withTenantContext. */
export async function findOrderCrossTenant(refs: Array<string | null | undefined>): Promise<{
  id: string;
  tenantId: string;
  status: string;
  providerRef: string | null;
  idempotencyKey: string;
  amountPaise: number | null;
  currency: string;
  meta: OrderMeta;
} | null> {
  const { directPrisma } = await import("@wavesco/db");
  const client = directPrisma();
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    const byPk = await client.acquisitionOrder.findFirst({ where: { providerRef: ref } });
    if (byPk) return mapOrder(byPk);
  }
  for (const ref of refs) {
    if (!ref) continue;
    const byMeta = await client.acquisitionOrder.findFirst({
      where: { meta: { path: ["paymentId"], equals: ref } },
    });
    if (byMeta) return mapOrder(byMeta);
  }
  return null;
}

function mapOrder(o: Record<string, unknown>) {
  return {
    id: o.id as string,
    tenantId: o.tenantId as string,
    status: o.status as string,
    providerRef: (o.providerRef as string | null) ?? null,
    idempotencyKey: o.idempotencyKey as string,
    amountPaise: (o.amountPaise as number | null) ?? null,
    currency: (o.currency as string) ?? "INR",
    meta: orderMeta(o as { meta?: unknown }),
  };
}
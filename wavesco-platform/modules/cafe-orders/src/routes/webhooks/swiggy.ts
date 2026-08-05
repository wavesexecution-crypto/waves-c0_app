import { createHash } from "node:crypto";
import type { Prisma } from "@wavesco/db";
import { withTenantContext } from "@wavesco/db";
import { verifyHmacSignature } from "../../lib/hmac";
import { parseSwiggyPayload } from "../../lib/parsers";
import type { WebhookHandler } from "../../types";

function orderDedupHash(externalOrderId: string, source: string): string {
  return createHash("sha256").update(`${source}:${externalOrderId}`).digest("hex");
}

/**
 * Swiggy webhook. Verifies the HMAC-SHA256 signature against
 * SWIGGY_SECRET, then upserts the order (dedup by unique key).
 */
export const swiggyWebhook: WebhookHandler = async ({ request, tenantId }) => {
  const secret = process.env.SWIGGY_SECRET;
  if (!secret) {
    return new Response("SWIGGY_SECRET is not set", { status: 500 });
  }

  const rawBody = await request.text();
  const signature =
    request.headers.get("x-swiggy-signature") ?? request.headers.get("x-hub-signature-256");

  if (!verifyHmacSignature(secret, rawBody, signature)) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const order = parseSwiggyPayload(payload);
  if (!order.externalOrderId) {
    return new Response("missing order_id", { status: 400 });
  }

  const dedupHash = orderDedupHash(order.externalOrderId, order.source);

  await withTenantContext(tenantId, async (tx) => {
    await tx.cafeOrder.upsert({
      where: {
        tenantId_externalOrderId_source: {
          tenantId,
          externalOrderId: order.externalOrderId,
          source: order.source,
        },
      },
      create: {
        tenantId,
        externalOrderId: order.externalOrderId,
        source: order.source,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        items: order.items,
        totalPaise: order.totalPaise,
        placedAt: order.placedAt,
        dedupHash,
        rawPayload: payload as Prisma.InputJsonValue,
      },
      update: {
        dupCount: { increment: 1 },
        rawPayload: payload as Prisma.InputJsonValue,
      },
    });
  });

  return new Response("ok", { status: 200 });
};

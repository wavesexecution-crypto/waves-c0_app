import { z } from "zod";
import { withTenantContext } from "@wavesco/db";

export const orderStatusSchema = z.enum([
  "RECEIVED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "COMPLETED",
  "CANCELLED",
]);

export type OrderStatus = z.infer<typeof orderStatusSchema>;

export interface OrderListItem {
  id: string;
  externalOrderId: string;
  source: string;
  status: string;
  totalPaise: number;
  placedAt: Date;
  dupCount: number;
}

export async function listOrders(tenantId: string, limit = 20): Promise<OrderListItem[]> {
  return withTenantContext(tenantId, async (tx) =>
    tx.cafeOrder.findMany({
      where: { tenantId },
      orderBy: { placedAt: "desc" },
      take: limit,
      select: {
        id: true,
        externalOrderId: true,
        source: true,
        status: true,
        totalPaise: true,
        placedAt: true,
        dupCount: true,
      },
    }),
  );
}

export async function markOrderStatus(
  tenantId: string,
  orderId: string,
  status: OrderStatus,
): Promise<void> {
  const parsed = orderStatusSchema.parse(status);
  await withTenantContext(tenantId, async (tx) => {
    await tx.cafeOrder.updateMany({
      where: { tenantId, id: orderId },
      data: { status: parsed },
    });
  });
}

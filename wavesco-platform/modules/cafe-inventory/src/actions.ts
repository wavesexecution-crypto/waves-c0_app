import { z } from "zod";
import { withTenantContext } from "@wavesco/db";

export const createItemInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().min(1).max(80).optional(),
  unit: z.string().default("pcs"),
  parLevel: z.number().nonnegative().default(0),
  reorderPoint: z.number().nonnegative().default(0),
  costPaise: z.number().int().nonnegative().default(0),
});

export type CreateItemInput = z.infer<typeof createItemInputSchema>;

export const adjustStockInputSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().refine((n) => Math.abs(n) > 0, "quantity cannot be zero"),
  type: z.enum(["PURCHASE", "SALE", "ADJUSTMENT", "WASTAGE"]),
  reason: z.string().trim().max(500).optional(),
});

export type AdjustStockInput = z.infer<typeof adjustStockInputSchema>;

export const wastageInputSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().positive(),
  reason: z.string().trim().min(1).max(500),
});

export type WastageInput = z.infer<typeof wastageInputSchema>;

export async function createItem(
  tenantId: string,
  input: CreateItemInput,
): Promise<{ id: string }> {
  const data = createItemInputSchema.parse(input);
  return withTenantContext(tenantId, async (tx) => {
    const item = await tx.cafeInventoryItem.create({
      data: {
        tenantId,
        name: data.name,
        sku: data.sku,
        unit: data.unit,
        parLevel: data.parLevel,
        reorderPoint: data.reorderPoint,
        costPaise: data.costPaise,
      },
      select: { id: true },
    });
    return { id: item.id };
  });
}

export async function adjustStock(
  tenantId: string,
  input: AdjustStockInput,
): Promise<void> {
  const data = adjustStockInputSchema.parse(input);
  await withTenantContext(tenantId, async (tx) => {
    const item = await tx.cafeInventoryItem.findUnique({
      where: { id: data.itemId },
      select: { id: true, currentStock: true },
    });
    if (!item) {
      throw new Error(`cafe-inventory: item ${data.itemId} not found`);
    }

    const nextStock = item.currentStock + data.quantity;
    if (nextStock < 0) {
      throw new Error("cafe-inventory: stock cannot go below zero");
    }

    await tx.cafeStockMovement.create({
      data: {
        tenantId,
        itemId: data.itemId,
        quantity: data.quantity,
        type: data.type,
        reason: data.reason,
      },
    });
    await tx.cafeInventoryItem.update({
      where: { id: data.itemId },
      data: { currentStock: nextStock },
    });
  });
}

export async function logWastage(tenantId: string, input: WastageInput): Promise<void> {
  const data = wastageInputSchema.parse(input);
  await withTenantContext(tenantId, async (tx) => {
    const item = await tx.cafeInventoryItem.findUnique({
      where: { id: data.itemId },
      select: { id: true, currentStock: true, costPaise: true },
    });
    if (!item) {
      throw new Error(`cafe-inventory: item ${data.itemId} not found`);
    }

    const now = new Date();
    const weekStart = new Date(now);
    const day = (now.getDay() + 6) % 7;
    weekStart.setDate(now.getDate() - day);
    weekStart.setHours(0, 0, 0, 0);

    await tx.cafeWastageLog.create({
      data: {
        tenantId,
        itemId: data.itemId,
        quantity: data.quantity,
        reason: data.reason,
        costPaise: Math.round(data.quantity * item.costPaise),
        weekStart,
      },
    });
    await tx.cafeInventoryItem.update({
      where: { id: data.itemId },
      data: { currentStock: Math.max(0, item.currentStock - data.quantity) },
    });
  });
}

export async function listLowStock(tenantId: string): Promise<{
  id: string;
  name: string;
  sku: string | null;
  currentStock: number;
  parLevel: number;
}[]> {
  return withTenantContext(tenantId, async (tx) => {
    const items = await tx.cafeInventoryItem.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, sku: true, currentStock: true, parLevel: true, reorderPoint: true },
    });
    return items
      .filter((item) => item.currentStock <= item.reorderPoint)
      .sort((a, b) => a.currentStock - b.currentStock);
  });
}

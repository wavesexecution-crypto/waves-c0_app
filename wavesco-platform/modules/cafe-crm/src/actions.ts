import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withTenantContext } from "@wavesco/db";
import { sendWhatsAppMessage } from "./lib/whatsapp";

export const CUSTOMER_TAGS = ["NEW", "RETURNING", "VIP"] as const;

export const upsertCustomerInputSchema = z.object({
  phone: z.string().min(6).max(20),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().optional(),
});

export type UpsertCustomerInput = z.infer<typeof upsertCustomerInputSchema>;

export const recordVisitInputSchema = z.object({
  customerId: z.string().min(1),
  totalPaise: z.number().int().nonnegative().default(0),
});

export type RecordVisitInput = z.infer<typeof recordVisitInputSchema>;

export const reengagementInputSchema = z.object({
  customerId: z.string().min(1),
  message: z.string().trim().min(1).max(1000),
});

export type ReengagementInput = z.infer<typeof reengagementInputSchema>;

function tagForVisits(visitCount: number): (typeof CUSTOMER_TAGS)[number] {
  if (visitCount >= 10) return "VIP";
  if (visitCount >= 2) return "RETURNING";
  return "NEW";
}

export async function upsertCustomer(
  tenantId: string,
  input: UpsertCustomerInput,
): Promise<{ id: string }> {
  const data = upsertCustomerInputSchema.parse(input);
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.cafeCustomer.findUnique({
      where: { tenantId_phone: { tenantId, phone: data.phone } },
    });
    const id = existing?.id ?? `cust_${randomUUID().replace(/-/g, "")}`;

    const customer = await tx.cafeCustomer.upsert({
      where: { tenantId_phone: { tenantId, phone: data.phone } },
      create: {
        id,
        tenantId,
        phone: data.phone,
        name: data.name,
        email: data.email,
        tag: "NEW",
      },
      update: {
        name: data.name ?? existing?.name,
        email: data.email ?? existing?.email,
      },
    });
    return { id: customer.id };
  });
}

export async function recordVisit(tenantId: string, input: RecordVisitInput): Promise<void> {
  const data = recordVisitInputSchema.parse(input);
  await withTenantContext(tenantId, async (tx) => {
    const customer = await tx.cafeCustomer.findUnique({
      where: { id: data.customerId },
      select: { id: true, visitCount: true, ltvPaise: true },
    });
    if (!customer) {
      throw new Error(`cafe-crm: customer ${data.customerId} not found`);
    }

    const visitCount = customer.visitCount + 1;
    await tx.cafeCustomerVisit.create({
      data: { tenantId, customerId: data.customerId, totalPaise: data.totalPaise },
    });
    await tx.cafeCustomer.update({
      where: { id: data.customerId },
      data: {
        visitCount,
        ltvPaise: customer.ltvPaise + data.totalPaise,
        lastVisitAt: new Date(),
        tag: tagForVisits(visitCount),
      },
    });
  });
}

/**
 * Sends a real WhatsApp re-engagement message and records the attempt.
 */
export async function sendReengagement(
  tenantId: string,
  input: ReengagementInput,
): Promise<{ id: string }> {
  const data = reengagementInputSchema.parse(input);
  return withTenantContext(tenantId, async (tx) => {
    const customer = await tx.cafeCustomer.findUnique({
      where: { id: data.customerId },
      select: { id: true, phone: true },
    });
    if (!customer) {
      throw new Error(`cafe-crm: customer ${data.customerId} not found`);
    }

    await sendWhatsAppMessage(customer.phone, data.message);

    const log = await tx.cafeReengagementLog.create({
      data: {
        tenantId,
        customerId: data.customerId,
        phone: customer.phone,
        message: data.message,
        status: "SENT",
        sentAt: new Date(),
      },
      select: { id: true },
    });
    return { id: log.id };
  });
}

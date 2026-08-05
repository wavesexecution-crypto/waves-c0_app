import { z } from "zod";
import { withTenantContext, prisma } from "@wavesco/db";
import { enrichLead } from "./lib/openai";
import { sendTelegramMessage } from "./lib/telegram";

export const createLeadInputSchema = z.object({
  phone: z.string().min(6).max(20),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().optional(),
  message: z.string().trim().min(1).max(4000),
  source: z.string().default("website"),
});

export type CreateLeadInput = z.infer<typeof createLeadInputSchema>;

/**
 * Captures a lead, runs AI enrichment (real OpenAI call) and fires a
 * real Telegram alert. Failures to enrich or notify are loud.
 */
export async function createLead(
  tenantId: string,
  input: CreateLeadInput,
): Promise<{ id: string }> {
  const data = createLeadInputSchema.parse(input);

  const [enrichment] = await Promise.all([enrichLead(data.message)]);

  return withTenantContext(tenantId, async (tx) => {
    const lead = await tx.cafeLead.create({
      data: {
        tenantId,
        phone: data.phone,
        name: data.name,
        email: data.email,
        message: data.message,
        source: data.source,
        category: enrichment.category,
        priority: enrichment.priority,
        summary: enrichment.summary,
        suggestedReply: enrichment.suggestedReply,
      },
    });

    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) {
      throw new Error("cafe-leads: TELEGRAM_CHAT_ID is not set. Cannot send alert (loud failure).");
    }

    await sendTelegramMessage({
      chatId,
      text: [
        "<b>New cafe lead</b>",
        `📞 ${data.phone}`,
        data.name ? `👤 ${data.name}` : null,
        `🏷 ${enrichment.category} · ${enrichment.priority}`,
        "",
        data.message.slice(0, 300),
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    });

    return { id: lead.id };
  });
}

export async function listLeads(tenantId: string, limit = 20): Promise<{
  id: string;
  phone: string;
  name: string | null;
  priority: string | null;
  createdAt: Date;
}[]> {
  return withTenantContext(tenantId, async (tx) =>
    tx.cafeLead.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, phone: true, name: true, priority: true, createdAt: true },
    }),
  );
}

export { prisma };

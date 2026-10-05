import { withTenantContext } from "@wavesco/db";

/**
 * Verified conversions — the ONLY states the system may claim as outcomes:
 *   MEETING — call booked and confirmed with the prospect
 *   WON     — converted to paying customer
 *   LOST    — explicitly lost / disqualified after engagement
 *
 * CTA clicks, email opens and sent counts are NOT conversions and never
 * appear here. One row per (tenant, leadKey), updated in place. Recording
 * WON/LOST/MEETING cancels pending automated follow-ups for that lead —
 * the human-owned relationship takes over.
 */

export type ConversionState = "MEETING" | "WON" | "LOST";

const STATES = new Set(["MEETING", "WON", "LOST"]);

export function validateConversion(input: Record<string, unknown>): {
  ok: boolean;
  error?: string;
  value?: { leadKey: string; state: ConversionState; note: string | null; businessName: string | null };
} {
  const leadKey = typeof input.leadKey === "string" ? input.leadKey.trim() : "";
  if (!leadKey) return { ok: false, error: "leadKey is required" };
  const state = typeof input.state === "string" ? input.state.trim().toUpperCase() : "";
  if (!STATES.has(state)) return { ok: false, error: "state must be MEETING|WON|LOST" };
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  const businessName = typeof input.businessName === "string" && input.businessName.trim()
    ? input.businessName.trim().slice(0, 200)
    : null;
  return { ok: true, value: { leadKey: leadKey.slice(0, 200), state: state as ConversionState, note, businessName } };
}

export async function recordConversion(
  tenantId: string,
  input: { leadKey: string; state: ConversionState; note: string | null; businessName: string | null },
  userId?: string | null,
): Promise<{ conversionId: string; state: ConversionState; followUpsCancelled: number }> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const existing = await tx.leadConversion.findUnique({ where: { tenantId_leadKey: { tenantId, leadKey: input.leadKey } } });
      let row;
      if (!existing) {
        row = await tx.leadConversion.create({
          data: {
            tenantId, leadKey: input.leadKey, businessName: input.businessName,
            state: input.state, note: input.note, createdByUserId: userId ?? null,
          },
        });
      } else {
        row = await tx.leadConversion.update({
          where: { id: existing.id },
          data: { state: input.state, note: input.note, businessName: input.businessName ?? existing.businessName, createdByUserId: userId ?? existing.createdByUserId },
        });
      }
      // A verified outcome ends automated follow-up for this lead.
      const cancelled = await tx.followUp.updateMany({
        where: { tenantId, leadKey: input.leadKey, status: "pending" },
        data: { status: "cancelled" },
      });
      await tx.activityEvent.create({
        data: {
          tenantId, type: "lead_converted",
          title: `${input.businessName ?? input.leadKey} marked ${input.state}`,
          entityType: "lead_conversion", entityId: row.id,
          href: "/acquisition/replies",
          metadata: { leadKey: input.leadKey, state: input.state, followUpsCancelled: cancelled.count } as never,
        },
      });
      return { conversionId: row.id, state: input.state, followUpsCancelled: cancelled.count };
    },
    userId ?? undefined,
  );
}

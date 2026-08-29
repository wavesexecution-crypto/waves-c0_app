"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@wavesco/auth";
import { withIdempotency, withTenantContext } from "@wavesco/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { recordActivity } from "@/lib/wavesco/activity";
import {
  selectCampaignCandidates,
  updateLeadOutreachState,
} from "@/lib/wavesco/lead-engine";
import { submitApproval, decideApproval as n8nDecideApproval } from "@/lib/wavesco/n8n";

async function requireUser(): Promise<{ tenantId: string; userId: string; role: string }> {
  const session = await auth();
  const user = requireSession(session);
  return { tenantId: user.tenantId, userId: user.id, role: user.role };
}

export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

// ------------------------------------------------------------------
// Eligibility preview (read-only; exact counts from real data)
// ------------------------------------------------------------------

async function computeEligibility(params: {
  location?: string;
  category?: string;
  tier?: string;
}): Promise<{
  selected: number;
  withEmail: number;
  verified: number;
  previouslyContacted: number;
  optedOut: number;
  eligible: number;
}> {
  const candidates = await selectCampaignCandidates({
    location: params.location,
    category: params.category,
    tier: params.tier,
  });
  const selected = candidates.length;
  const withEmail = candidates.filter((c) => c.email !== null).length;
  const verified = candidates.filter((c) => c.email !== null && c.emailVerified).length;
  const previouslyContacted = candidates.filter((c) => c.contacted).length;
  const optedOut = candidates.filter((c) => c.optedOut).length;
  const eligible = candidates.filter(
    (c) => c.email !== null && c.emailVerified && !c.contacted && !c.optedOut && !c.bounced,
  ).length;
  return { selected, withEmail, verified, previouslyContacted, optedOut, eligible };
}

/** Server-action wrapper: exact eligibility from the live corpus. */
 
export async function computeEligibilityAction(params: {
  location?: string;
  category?: string;
  tier?: string;
}): Promise<ReturnType<typeof computeEligibility>> {
  return computeEligibility(params);
}

// ------------------------------------------------------------------
// Campaign submission → existing Approval Queue (never sends directly)
// ------------------------------------------------------------------

const submitSchema = z.object({
  campaignId: z.string().min(1),
  subject: z.string().min(3).max(160),
  body: z.string().min(20).max(8000),
});

export async function submitCampaignAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "admin", "acquisition")) {
    return { ok: false, error: "Owner role required to submit campaign sends." };
  }

  const parsed = submitSchema.safeParse({
    campaignId: formData.get("campaignId"),
    subject: formData.get("subject"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Subject (3+) and body (20+) are required." };
  }

  const result = await withIdempotency(
    { tenantId: user.tenantId, userId: user.userId, scope: "campaign_submit", key: parsed.data.campaignId },
    async () => {
      return withTenantContext(user.tenantId, async (tx) => {
        const campaign = await tx.campaign.findFirst({
          where: { id: parsed.data.campaignId, tenantId: user.tenantId },
        });
        if (!campaign) return { ok: false as const, error: "Campaign not found." };

        const already = await tx.outreachEmail.count({
          where: { tenantId: user.tenantId, campaignId: campaign.id },
        });
        if (already > 0) {
          return { ok: false as const, error: `This campaign already has ${already} queued emails.` };
        }

        const allCandidates = await selectCampaignCandidates({
          location: campaign.location ?? undefined,
          category: campaign.category ?? undefined,
          tier: campaign.tier ?? undefined,
        });
        const candidates = allCandidates.filter(
          (c) =>
            c.email !== null &&
            c.emailVerified &&
            !c.contacted &&
            !c.optedOut &&
            !c.bounced,
        );

        const limit = campaign.sendingLimit ?? candidates.length;
        const batch = candidates.slice(0, limit);

        // Snapshot the exact eligibility math at send time.
        await tx.campaign.update({
          where: { id: campaign.id },
          data: {
            status: "sending",
            eligibleSnapshot: {
              selected: candidates.length,
              eligible: batch.length,
              limit,
              capturedAt: new Date().toISOString(),
            } as never,
          },
        });

        let submitted = 0;
        let failedSubmissions = 0;
        for (const c of batch) {
          if (c.email === null) continue;
          const email: string = c.email;
          const res = await submitApproval({
            type: "cold_email",
            recipient: email,
            subject: parsed.data.subject,
            body: parsed.data.body,
          });
          let approvalId: string | null = null;
          if (res.ok && res.data !== null && typeof res.data === "object") {
            const rec = res.data as Record<string, unknown>;
            const raw = typeof rec.approval_id === "string" || typeof rec.approval_id === "number"
              ? rec.approval_id
              : typeof rec.id === "string" || typeof rec.id === "number"
                ? rec.id
                : null;
            approvalId = raw === null ? null : String(raw);
          }

          await tx.outreachEmail.create({
            data: {
              tenantId: user.tenantId,
              campaignId: campaign.id,
              leadKey: c.nameKey,
              business: c.business,
              email,
              subject: parsed.data.subject,
              body: parsed.data.body,
              status: res.ok ? "submitted" : "failed",
              approvalId,
              error: res.ok ? null : (res.error ?? `webhook ${res.status}`),
              submittedAt: res.ok ? new Date() : null,
            },
          });

          await updateLeadOutreachState(c.nameKey, { date_contacted: new Date().toISOString() });

          if (res.ok) submitted += 1;
          else failedSubmissions += 1;
        }

        await tx.campaign.update({
          where: { id: campaign.id },
          data: { status: failedSubmissions === 0 ? "sent" : "paused" },
        });

        return {
          ok: true as const,
          message: `${submitted} email(s) queued to the existing Approval Queue. Approve them here or via Telegram.`,
          campaignName: campaign.name,
          submitted,
          failedSubmissions,
        };
      });
    },
  );

  if (!result.ok) return { ok: false, error: result.error };

  await recordActivity(user.tenantId, {
    type: "email_submitted",
    title: `Campaign "${result.campaignName}": ${result.submitted} queued to Approval Queue${result.failedSubmissions > 0 ? `, ${result.failedSubmissions} webhook failures` : ""}`,
    entityType: "campaign",
    href: "/acquisition/outreach",
    metadata: { submitted: result.submitted, failedSubmissions: result.failedSubmissions },
  });

  revalidatePath("/acquisition/outreach");
  revalidatePath("/acquisition/campaigns");
  revalidatePath("/command");
  return { ok: true, message: result.message };
}

// ------------------------------------------------------------------
// Approval decision → existing /approval-decide endpoint
// ------------------------------------------------------------------

function extractDispatchResult(data: unknown): { sent: boolean; detail: string | null } {
  if (!data || typeof data !== "object") return { sent: false, detail: null };
  const rec = data as Record<string, unknown>;
  const asText = (v: unknown): string | null =>
    typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : null;
  const delivered = asText(rec.delivered) ?? asText(rec.status) ?? "";
  const err = asText(rec.error) ?? asText(rec.message);
  const sent =
    delivered.includes("telegram_sent") ||
    delivered.includes("sent") ||
    rec.sent === true ||
    rec.ok === true;
  return { sent, detail: err ?? (delivered.length > 0 ? delivered : null) };
}

const decideSchema = z.object({
  outreachEmailId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
});

export async function decideOutreachEmailAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "admin", "acquisition")) {
    return { ok: false, error: "Admin role required to decide approvals." };
  }

  const parsed = decideSchema.safeParse({
    outreachEmailId: formData.get("outreachEmailId"),
    decision: formData.get("decision"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid decision request." };

  const row = await withTenantContext(user.tenantId, async (tx) =>
    tx.outreachEmail.findFirst({
      where: { id: parsed.data.outreachEmailId, tenantId: user.tenantId },
    }),
  );
  if (!row) return { ok: false, error: "Queued email not found." };
  if (row.decidedAt) return { ok: false, error: `Already decided (${row.status}).` };

  const approvalNumericId = Number(row.approvalId);
  if (!row.approvalId || !Number.isFinite(approvalNumericId)) {
    return {
      ok: false,
      error:
        "No numeric approval id stored for this email — approve it via Telegram (`approve N`) or re-check the queue.",
    };
  }

  const res = await n8nDecideApproval(approvalNumericId, parsed.data.decision);

  await withTenantContext(user.tenantId, async (tx) => {
    if (parsed.data.decision === "reject" && res.ok) {
      await tx.outreachEmail.update({
        where: { id: row.id },
        data: { status: "rejected", decidedAt: new Date() },
      });
      await recordActivity(user.tenantId, {
        type: "email_rejected",
        title: `Cold email to ${row.business} rejected`,
        entityType: "outreach_email",
        entityId: row.id,
        href: "/acquisition/outreach",
      });
    } else if (parsed.data.decision === "approve") {
      if (!res.ok) {
        await tx.outreachEmail.update({
          where: { id: row.id },
          data: { error: res.error ?? `decide endpoint HTTP ${res.status}`, decidedAt: new Date() },
        });
        return;
      }
      const dispatch = extractDispatchResult(res.data);
      const now = new Date();
      await tx.outreachEmail.update({
        where: { id: row.id },
        data: dispatch.sent
          ? { status: "sent", sentAt: now, decidedAt: now, error: null, messageId: dispatch.detail }
          : { status: "approved", decidedAt: now },
      });
      await recordActivity(user.tenantId, {
        type: dispatch.sent ? "email_sent" : "email_approved",
        title: dispatch.sent
          ? `Cold email dispatched to ${row.email}`
          : `Cold email approved — dispatched via Email Outbox (${dispatch.detail ?? "result pending"})`,
        entityType: "outreach_email",
        entityId: row.id,
        href: "/acquisition/outreach",
        metadata: { decisionResponse: res.data ?? null },
      });
    }
  });

  if (!res.ok) {
    return { ok: false, error: `n8n decide endpoint failed: ${res.error ?? res.status}` };
  }

  revalidatePath("/acquisition/outreach");
  revalidatePath("/command");
  return { ok: true, message: `Decision "${parsed.data.decision}" applied through n8n.` };
}

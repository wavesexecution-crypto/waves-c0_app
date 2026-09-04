"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@wavesco/auth";
import { withTenantContext } from "@wavesco/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { startGeneration } from "@/lib/wavesco/generation";
import {
  getLastEngineRun,
  getLead,
  leadEngineMode,
  listBatchManifests,
  updateLeadOutreachState,
} from "@/lib/wavesco/lead-engine";
import { recordActivity } from "@/lib/wavesco/activity";
import {
  onLeadGenerationCompleted,
  onLeadReportReady,
} from "@/lib/wavesco/notify";

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

/** Reads an optional string field; empty becomes undefined. */
function optStr(formData: FormData, name: string): string | undefined {
  const v = formData.get(name);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ------------------------------------------------------------------
// Lead generation (spawns the real engine)
// ------------------------------------------------------------------

const generateSchema = z.object({
  requestedCount: z.coerce.number().int().min(1).max(60),
});

export async function generateLeadsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "acquisition")) {
    return { ok: false, error: "Admin role required to run lead generation." };
  }

  const parsed = generateSchema.safeParse({
    requestedCount: formData.get("requestedCount"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Lead count must be between 1 and 60." };
  }

  const result = await startGeneration(user.tenantId, user.userId, {
    requestedCount: parsed.data.requestedCount,
  });

  if (!result.ok) {
    await recordActivity(user.tenantId, {
      type: "generation_failed",
      title: `Lead Engine failed to start: ${result.error}`,
      href: "/acquisition/generate",
    });
    return { ok: false, error: result.error };
  }

  await recordActivity(user.tenantId, {
    type: "generation_started",
    title: `Lead Engine batch queued — target ${parsed.data.requestedCount} new leads`,
    entityType: "generation",
    entityId: result.requestId,
    href: "/acquisition/generate",
  });
  revalidatePath("/acquisition/generate");
  revalidatePath("/command");
  return { ok: true, message: result.requestId };
}

export interface GenerationStatus {
  requestId: string;
  status: string;
  stage: string | null;
  logTail: string | null;
  engineBatchId: string | null;
  resultLeadCount: number | null;
  emailReadyCount: number | null;
  pdfPath: string | null;
  excelPath: string | null;
  error: string | null;
  finishedAt: string | null;
}

export async function getGenerationStatusAction(
  requestId: string,
): Promise<GenerationStatus | null> {
  const user = await requireUser();
  return withTenantContext(user.tenantId, async (tx) => {
    const row = await tx.generationBatch.findUnique({ where: { requestId } });
    if (!row) return null;

    // Remote mode: lazily sync with engine so Vercel serverless polling can
    // observe completion even though the in-process monitor does not survive.
    if (leadEngineMode() === "remote" && row.status === "running") {
      try {
        const last = await getLastEngineRun().catch(() => undefined);
        const tail =
          (last as unknown as { log_tail?: string | null } | undefined)?.log_tail
          ?? (last as unknown as { logTail?: string | null } | undefined)?.logTail
          ?? null;
        if (tail && tail !== row.logTail) {
          await tx.generationBatch.update({ where: { requestId }, data: { logTail: tail.slice(-2000) } });
          row.logTail = tail.slice(-2000);
        }
        const all = await listBatchManifests().catch(() => []);
        const manifest = all.find((m) => {
          const t = m.generatedAt ? new Date(m.generatedAt).getTime() : 0;
          const since = (row.startedAt ?? row.createdAt).getTime();
          return t >= since - 5000;
        });
        if (manifest) {
          await tx.generationBatch.update({
            where: { requestId },
            data: {
              status: "completed",
              stage: "completed",
              engineBatchId: manifest.batchId,
              resultLeadCount: manifest.leadCount ?? null,
              emailReadyCount: manifest.emailReadyCount ?? null,
              pdfPath: manifest.pdfPath ?? null,
              excelPath: manifest.excelPath ?? null,
              finishedAt: new Date(),
              logTail: tail?.slice(-2000) ?? row.logTail,
            },
          });
          // Real transition (serverless poll): batch confirmed completed.
          const suffix = `batch-${requestId}`;
          onLeadGenerationCompleted(
            user.tenantId,
            undefined,
            {
              leadCount: manifest.leadCount ?? undefined,
              qualifiedCount: manifest.emailReadyCount ?? undefined,
            },
            undefined,
            suffix,
          );
          if (manifest.pdfPath || manifest.excelPath) {
            onLeadReportReady(user.tenantId, undefined, {}, undefined, suffix);
          }
          const updated = await tx.generationBatch.findUnique({ where: { requestId } });
          if (updated) {
            return {
              requestId: updated.requestId,
              status: updated.status,
              stage: updated.stage,
              logTail: updated.logTail ? updated.logTail.slice(-1200) : null,
              engineBatchId: updated.engineBatchId,
              resultLeadCount: updated.resultLeadCount,
              emailReadyCount: updated.emailReadyCount,
              pdfPath: updated.pdfPath,
              excelPath: updated.excelPath,
              error: updated.error,
              finishedAt: updated.finishedAt?.toISOString() ?? null,
            };
          }
        }
      } catch {
        // best-effort — return current row if engine probe fails
      }
    }

    return {
      requestId: row.requestId,
      status: row.status,
      stage: row.stage,
      logTail: row.logTail ? row.logTail.slice(-1200) : null,
      engineBatchId: row.engineBatchId,
      resultLeadCount: row.resultLeadCount,
      emailReadyCount: row.emailReadyCount,
      pdfPath: row.pdfPath,
      excelPath: row.excelPath,
      error: row.error,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  });
}

// ------------------------------------------------------------------
// Lead outreach state write-back (single source of truth stays the engine DB)
// ------------------------------------------------------------------

const outreachSchema = z.object({
  nameKey: z.string().min(1),
  emailStatus: z.enum(["Verified", "Unverified", "Invalid", ""]).optional(),
  optedOut: z.boolean().optional(),
  bounced: z.boolean().optional(),
  replyStatus: z.string().max(60).optional(),
});

export async function updateLeadOutreachAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "acquisition")) {
    return { ok: false, error: "Admin role required to update outreach state." };
  }

  const parsed = outreachSchema.safeParse({
    nameKey: formData.get("nameKey"),
    emailStatus: optStr(formData, "emailStatus"),
    optedOut: formData.get("optedOut") === "true" ? true : formData.get("optedOut") === "false" ? false : undefined,
    bounced: formData.get("bounced") === "true" ? true : formData.get("bounced") === "false" ? false : undefined,
    replyStatus: optStr(formData, "replyStatus"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid outreach update." };
  }
  const lead = await getLead(parsed.data.nameKey);
  if (!lead) {
    return { ok: false, error: "Lead not found in the engine corpus." };
  }

  try {
    await updateLeadOutreachState(parsed.data.nameKey, {
      email_status: parsed.data.emailStatus,
      opted_out: parsed.data.optedOut,
      bounced: parsed.data.bounced,
      reply_status: parsed.data.replyStatus,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Engine write-back failed." };
  }

  await recordActivity(user.tenantId, {
    type: parsed.data.replyStatus ? "reply_received" : "lead_verified",
    title: `${lead.business}: ${parsed.data.replyStatus ? `reply marked "${parsed.data.replyStatus}"` : `email status → ${parsed.data.emailStatus}`}${parsed.data.optedOut === true ? " · opted out" : ""}${parsed.data.bounced === true ? " · bounced" : ""}`,
    entityType: "lead",
    entityId: parsed.data.nameKey,
    href: `/acquisition/leads/${encodeURIComponent(parsed.data.nameKey)}`,
  });

  revalidatePath(`/acquisition/leads/${encodeURIComponent(parsed.data.nameKey)}`);
  revalidatePath("/acquisition/leads");
  revalidatePath("/command");
  return { ok: true, message: "Saved to lead database." };
}

// ------------------------------------------------------------------
// Campaigns
// ------------------------------------------------------------------

const campaignSchema = z.object({
  name: z.string().min(2).max(80),
  location: z.string().max(60).optional(),
  category: z.string().max(60).optional(),
  tier: z.enum(["A", "B", "C", "all"]).optional(),
  sendingLimit: z.coerce.number().int().min(1).max(200).optional(),
});

export interface EligibilityBreakdown {
  selected: number;
  withEmail: number;
  verified: number;
  previouslyContacted: number;
  optedOut: number;
  eligible: number;
}

export async function createCampaignAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "acquisition")) {
    return { ok: false, error: "Admin role required to create campaigns." };
  }
  const parsed = campaignSchema.safeParse({
    name: formData.get("name"),
    location: optStr(formData, "location"),
    category: optStr(formData, "category"),
    tier: optStr(formData, "tier"),
    sendingLimit: optStr(formData, "sendingLimit"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Campaign name is required (2–80 chars)." };
  }

  await withTenantContext(user.tenantId, async (tx) => {
    await tx.campaign.create({
      data: {
        tenantId: user.tenantId,
        name: parsed.data.name,
        location: parsed.data.location,
        category: parsed.data.category,
        tier: parsed.data.tier && parsed.data.tier !== "all" ? parsed.data.tier : null,
        sendingLimit: parsed.data.sendingLimit,
        createdByUserId: user.userId,
        status: "draft",
      },
    });
  });

  await recordActivity(user.tenantId, {
    type: "campaign_created",
    title: `Campaign "${parsed.data.name}" created`,
    entityType: "campaign",
    href: "/acquisition/campaigns",
  });
  revalidatePath("/acquisition/campaigns");
  return { ok: true, message: "Campaign created." };
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { requireSession } from "@wavesco/auth";
import { withTenantContext } from "@wavesco/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { recordActivity } from "@/lib/wavesco/activity";
import { getBatchManifest } from "@/lib/wavesco/lead-engine";
import { n8nBaseUrl } from "@/lib/wavesco/n8n";

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

function optStr(formData: FormData, name: string): string | undefined {
  const v = formData.get(name);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ------------------------------------------------------------------
// Follow-ups
// ------------------------------------------------------------------

const followUpSchema = z.object({
  business: z.string().min(1).max(120),
  leadKey: z.string().max(200).optional(),
  dueAt: z.string().min(4),
  note: z.string().max(500).optional(),
});

export async function createFollowUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "acquisition")) {
    return { ok: false, error: "Admin role required to schedule follow-ups." };
  }
  const parsed = followUpSchema.safeParse({
    business: formData.get("business"),
    leadKey: optStr(formData, "leadKey"),
    dueAt: formData.get("dueAt"),
    note: optStr(formData, "note"),
  });
  if (!parsed.success || Number.isNaN(new Date(parsed.data.dueAt).getTime())) {
    return { ok: false, error: "Business name and a valid due date are required." };
  }

  await withTenantContext(user.tenantId, async (tx) => {
    await tx.followUp.create({
      data: {
        tenantId: user.tenantId,
        business: parsed.data.business,
        leadKey: parsed.data.leadKey,
        dueAt: new Date(parsed.data.dueAt),
        note: parsed.data.note,
        status: "pending",
      },
    });
  });

  await recordActivity(user.tenantId, {
    type: "followup_created",
    title: `Follow-up scheduled for ${parsed.data.business}`,
    entityType: "follow_up",
    href: "/acquisition/follow-ups",
  });
  revalidatePath("/acquisition/follow-ups");
  revalidatePath("/command");
  return { ok: true, message: "Follow-up created." };
}

const completeSchema = z.object({
  followUpId: z.string().min(1),
  action: z.enum(["done", "cancel"]),
});

export async function updateFollowUpStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "acquisition")) {
    return { ok: false, error: "Admin role required." };
  }
  const parsed = completeSchema.safeParse({
    followUpId: formData.get("followUpId"),
    action: formData.get("action"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  await withTenantContext(user.tenantId, async (tx) => {
    await tx.followUp.updateMany({
      where: { id: parsed.data.followUpId, tenantId: user.tenantId },
      data:
        parsed.data.action === "done"
          ? { status: "done", completedAt: new Date() }
          : { status: "cancelled" },
    });
  });

  await recordActivity(user.tenantId, {
    type: "followup_done",
    title: `Follow-up ${parsed.data.action === "done" ? "completed" : "cancelled"}`,
    entityType: "follow_up",
    entityId: parsed.data.followUpId,
    href: "/acquisition/follow-ups",
  });
  revalidatePath("/acquisition/follow-ups");
  revalidatePath("/command");
  return { ok: true };
}

// ------------------------------------------------------------------
// Reports → resend through the EXISTING Notify Hub bridge
// ------------------------------------------------------------------

const resendSchema = z.object({ batchId: z.string().min(3).max(40) });

export async function resendReportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "acquisition")) {
    return { ok: false, error: "Admin role required to resend reports." };
  }
  const parsed = resendSchema.safeParse({ batchId: formData.get("batchId") });
  if (!parsed.success) return { ok: false, error: "Invalid batch id." };

  const manifest = await getBatchManifest(parsed.data.batchId);
  if (!manifest) return { ok: false, error: "Batch manifest not found on disk." };

  const files: { name: string; base64: string }[] = [];
  for (const p of [manifest.pdfPath, manifest.excelPath]) {
    if (p && existsSync(p)) {
      try {
        files.push({
          name: p.split(/[\\/]/).pop() ?? "report",
          base64: readFileSync(p).toString("base64"),
        });
      } catch {
        // unreadable — skip this file
      }
    }
  }
  if (files.length === 0) {
    return { ok: false, error: "Report files are no longer present on disk." };
  }

  const base = n8nBaseUrl();
  if (!base) return { ok: false, error: "N8N_BASE_URL not configured." };

  let delivered = "";
  try {
    const res = await fetch(`${base}/webhook/personal/wavesco-leads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        level: "info",
        subject: "WAVESCO LEAD BATCH READY",
        body: `Resent from WavesCo Command Center — batch ${manifest.batchId}: ${manifest.leadCount ?? "?"} leads, ${manifest.emailReadyCount ?? "?"} email-ready.`,
        files,
        source_workflow: "WavesCo Platform",
        dedupe_key: `leads|resend-${manifest.batchId}-${Date.now()}`.slice(0, 90),
      }),
      cache: "no-store",
    });
    try {
      const j = (await res.json()) as Record<string, unknown>;
      const d = j.delivered;
      delivered =
        typeof d === "string"
          ? d
          : typeof d === "number" || typeof d === "boolean"
            ? String(d)
            : "";
    } catch {
      // non-JSON response
    }
    if (!res.ok) return { ok: false, error: `Notify Hub webhook returned HTTP ${res.status}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Notify Hub unreachable." };
  }

  const okDelivery = delivered.includes("telegram_sent") || delivered.length > 0;
  await recordActivity(user.tenantId, {
    type: okDelivery ? "report_delivered" : "automation_failed",
    title: okDelivery
      ? `Batch ${manifest.batchId} resent to Telegram (${delivered})`
      : `Telegram delivery unresolved for batch ${manifest.batchId}`,
    entityType: "batch",
    entityId: manifest.batchId,
    href: "/acquisition/reports",
    metadata: { delivered },
  });

  revalidatePath("/acquisition/reports");
  revalidatePath("/command");
  return okDelivery
    ? { ok: true, message: `Delivered via Notify Hub (${delivered || "accepted"}).` }
    : { ok: false, error: `Notify Hub accepted but delivery state unclear (${delivered || "no field"}).` };
}

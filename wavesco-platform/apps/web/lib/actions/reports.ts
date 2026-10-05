"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { requireSession } from "@wavesco/auth";
import { withTenantContext } from "@wavesco/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { recordActivity } from "@/lib/wavesco/activity";
import { fetchManifestFile, getBatchManifest, leadEngineMode } from "@/lib/wavesco/lead-engine";
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
  const dueAt = new Date(parsed.data.dueAt);
  if (dueAt.getTime() < Date.now() - 60_000) {
    return { ok: false, error: "Due date must be in the future — past follow-ups cannot be scheduled." };
  }

  const created = await withTenantContext(user.tenantId, async (tx) => {
    // Idempotent double-submit: an identical pending follow-up already
    // exists → return it instead of duplicating.
    const dupe = await tx.followUp.findFirst({
      where: {
        tenantId: user.tenantId,
        business: parsed.data.business,
        leadKey: parsed.data.leadKey ?? null,
        dueAt,
        status: "pending",
      },
      select: { id: true },
    });
    if (dupe) return { id: dupe.id, duplicate: true as const };
    const row = await tx.followUp.create({
      data: {
        tenantId: user.tenantId,
        business: parsed.data.business,
        leadKey: parsed.data.leadKey,
        dueAt,
        note: parsed.data.note,
        status: "pending",
      },
    });
    return { id: row.id, duplicate: false as const };
  });

  await recordActivity(user.tenantId, {
    type: "followup_created",
    title: `Follow-up scheduled for ${parsed.data.business}`,
    entityType: "follow_up",
    href: "/acquisition/follow-ups",
  });
  revalidatePath("/acquisition/follow-ups");
  revalidatePath("/command");
  // Always report what actually happened. A duplicate submit created nothing.
  return created.duplicate
    ? { ok: true, message: "That follow-up already exists — no duplicate created." }
    : { ok: true, message: "Follow-up scheduled." };
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

  // updateMany reports how many rows actually changed. Discarding it made a
  // no-op (stale id, already-closed follow-up) report success.
  const changed = await withTenantContext(user.tenantId, async (tx) => {
    const res = await tx.followUp.updateMany({
      where: {
        id: parsed.data.followUpId,
        tenantId: user.tenantId,
        status: "pending",
      },
      data:
        parsed.data.action === "done"
          ? { status: "done", completedAt: new Date() }
          : { status: "cancelled" },
    });
    return res.count;
  });

  if (changed === 0) {
    return {
      ok: false,
      error: "That follow-up is no longer open — it may already be closed. Refresh to see the current list.",
    };
  }

  await recordActivity(user.tenantId, {
    type: "followup_done",
    title: `Follow-up ${parsed.data.action === "done" ? "completed" : "cancelled"}`,
    entityType: "follow_up",
    entityId: parsed.data.followUpId,
    href: "/acquisition/follow-ups",
  });
  revalidatePath("/acquisition/follow-ups");
  revalidatePath("/command");
  return {
    ok: true,
    message: parsed.data.action === "done" ? "Follow-up marked done." : "Follow-up cancelled.",
  };
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
  // Durable copies first: previously archived StoredObjects survive engine
  // restarts. Legacy engine-host paths below are the fallback.
  try {
    const { wavesStorageConfig } = await import("@/lib/wavesco/object-storage");
    const { storageGet } = await import("@/lib/wavesco/object-storage");
    const resolved = wavesStorageConfig();
    if (!("error" in resolved)) {
      const archived = await withTenantContext(user.tenantId, async (tx) =>
        tx.storedObject.findMany({
          where: { tenantId: user.tenantId, batchId: manifest.batchId, kind: "report", status: "READY" },
        }),
      );
      for (const o of archived) {
        const got = await storageGet(resolved.config, user.tenantId, o.objectKey).catch(() => null);
        if (got?.ok && got.data) {
          files.push({ name: o.fileName, base64: got.data.body.toString("base64") });
        }
      }
    }
  } catch {
    // fall through to legacy paths
  }
  const seen = new Set(files.map((f) => f.name));
  // In remote mode the manifest paths are on the engine host and never exist on
  // the Next host, so this used to report "no longer present on disk" while the
  // PDF link directly above it downloaded fine. Fetch through the engine API.
  if (files.length < 2 && leadEngineMode() === "remote") {
    for (const type of ["pdf", "xlsx"] as const) {
      const name = `${manifest.batchId}.${type}`;
      if (seen.has(name)) continue;
      const got = await fetchManifestFile(manifest.batchId, type).catch(() => null);
      if (got?.ok) {
        files.push({ name: got.filename ?? name, base64: Buffer.from(got.body).toString("base64") });
        seen.add(name);
      }
    }
  }
  for (const p of [manifest.pdfPath, manifest.excelPath]) {
    if (p && existsSync(p)) {
      try {
        const name = p.split(/[\\/]/).pop() ?? "report";
        if (seen.has(name)) continue; // already attached from durable storage
        files.push({
          name,
          base64: readFileSync(p).toString("base64"),
        });
        seen.add(name);
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

  // `delivered.length > 0` treated "failed", "queued" or any other non-empty
  // value as success, so a failed Telegram send rendered in emerald and wrote a
  // report_delivered audit row.
  const okDelivery = delivered
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .every((s) => s === "telegram_sent");
  await recordActivity(user.tenantId, {
    type: okDelivery ? "report_delivered" : "automation_failed",
    title: okDelivery
      ? `Batch ${manifest.batchId} resent to Telegram`
      : `Telegram delivery did not confirm for batch ${manifest.batchId}`,
    entityType: "batch",
    entityId: manifest.batchId,
    href: "/acquisition/reports",
    metadata: { delivered },
  });

  revalidatePath("/acquisition/reports");
  revalidatePath("/command");
  return okDelivery
    ? { ok: true, message: "Sent to Telegram." }
    : {
        ok: false,
        error: "Telegram did not confirm delivery. The files are still available to download on this page.",
      };
}

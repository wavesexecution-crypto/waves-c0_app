"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@wavesco/auth";
import { withTenantContext } from "@wavesco/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { recordActivity } from "@/lib/wavesco/activity";
import { auditControl } from "@/lib/wavesco/control";
import {
  cancelOrder,
  checkLeadEmail,
  createOutreachOrder,
  decideOrderApproval,
  listPipelineLeads,
  logBatchToObsidian,
  notifyBatchSummary,
  researchLead,
  submitOrderToApproval,
  type BatchCounts,
} from "@/lib/wavesco/pipeline";

async function requireUser(): Promise<{ tenantId: string; userId: string; role: string }> {
  const session = await auth();
  const user = requireSession(session);
  return { tenantId: user.tenantId, userId: user.id, role: user.role };
}

export interface PipelineActionState {
  ok: boolean;
  error?: string;
  message?: string;
  counts?: BatchCounts & { telegram?: string; obsidian?: boolean; skipped?: number };
}

function str(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

// ------------------------------------------------------------------
// Single-lead stage actions
// ------------------------------------------------------------------

const leadKeySchema = z.object({ nameKey: z.string().min(1).max(200) });

export async function researchLeadAction(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "acquisition")) return { ok: false, error: "Admin role required." };
  const parsed = leadKeySchema.safeParse({ nameKey: str(formData, "nameKey") });
  if (!parsed.success) return { ok: false, error: "Invalid lead." };

  const res = await researchLead(user.tenantId, parsed.data.nameKey);
  if (!res.ok) return { ok: false, error: res.error };

  // audit enrich — safe, tenant-scoped
  await auditControl({
    tenantId: user.tenantId,
    userId: user.userId,
    action: "leads.enrich",
    model: "LeadResearch",
    recordId: parsed.data.nameKey,
    after: { researched: true },
  }).catch(() => {});

  revalidatePipeline();
  return { ok: true, message: "Research snapshot saved." };
}

export async function checkLeadEmailAction(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "acquisition")) return { ok: false, error: "Admin role required." };
  const parsed = leadKeySchema.safeParse({ nameKey: str(formData, "nameKey") });
  if (!parsed.success) return { ok: false, error: "Invalid lead." };

  const res = await checkLeadEmail(user.tenantId, parsed.data.nameKey);
  await auditControl({
    tenantId: user.tenantId,
    userId: user.userId,
    action: "leads.verify",
    model: "LeadResearch",
    recordId: parsed.data.nameKey,
    after: { status: res.status, email: res.email },
  }).catch(() => {});
  revalidatePipeline();
  return res.ok
    ? { ok: true, message: `${res.status}${res.reason ? ` — ${res.reason}` : ""}` }
    : { ok: false, error: res.reason || "Check failed." };
}

export async function generateOutreachOrderAction(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "acquisition")) return { ok: false, error: "Admin role required." };
  const parsed = leadKeySchema.safeParse({ nameKey: str(formData, "nameKey") });
  if (!parsed.success) return { ok: false, error: "Invalid lead." };

  const res = await createOutreachOrder(user.tenantId, user.userId, parsed.data.nameKey);
  if (!res.ok) return { ok: false, error: res.error ?? "Generation failed." };

  revalidatePipeline();
  return { ok: true, message: "Outreach order created — ready for approval." };
}

const orderIdSchema = z.object({ orderId: z.string().min(1).max(64) });

export async function submitOrderAction(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "acquisition")) return { ok: false, error: "Admin role required." };
  const parsed = orderIdSchema.safeParse({ orderId: str(formData, "orderId") });
  if (!parsed.success) return { ok: false, error: "Invalid order." };

  const res = await submitOrderToApproval(user.tenantId, parsed.data.orderId);
  if (!res.ok) return { ok: false, error: res.error };

  await withTenantContext(user.tenantId, async (tx) => {
    const order = await tx.outreachOrder.findUnique({ where: { id: parsed.data.orderId }, select: { businessName: true } });
    await recordActivity(user.tenantId, {
      type: "order_submitted",
      title: `Outreach order for ${order?.businessName ?? "lead"} queued to Approval Queue #${res.approvalId}`,
      entityType: "outreach_order",
      entityId: parsed.data.orderId,
      href: "/acquisition/pipeline",
      sourceKey: `order-submit:${parsed.data.orderId}`,
    });
  });

  revalidatePipeline();
  return { ok: true, message: `Queued as approval #${res.approvalId}. Nothing sends until approved.` };
}

export async function decideOrderAction(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "admin", "acquisition")) return { ok: false, error: "Owner role required to decide approvals." };
  const parsed = z
    .object({ orderId: z.string().min(1), decision: z.enum(["approve", "reject"]) })
    .safeParse({ orderId: str(formData, "orderId"), decision: str(formData, "decision") });
  if (!parsed.success) return { ok: false, error: "Invalid decision request." };

  const res = await decideOrderApproval(user.tenantId, parsed.data.orderId, parsed.data.decision);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePipeline();
  return res.sent
    ? { ok: true, message: "Approved and dispatched through the existing Email Outbox." }
    : { ok: true, message: `Decision applied (${res.deliveryStatus ?? parsed.data.decision}).` };
}

export async function cancelOrderAction(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "acquisition")) return { ok: false, error: "Admin role required." };
  const parsed = orderIdSchema.safeParse({ orderId: str(formData, "orderId") });
  if (!parsed.success) return { ok: false, error: "Invalid order." };

  const res = await cancelOrder(user.tenantId, parsed.data.orderId);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePipeline();
  return { ok: true, message: "Order cancelled; pending follow-ups stopped." };
}

// ------------------------------------------------------------------
// Batch actions (bounded, idempotent, real counters only)
// ------------------------------------------------------------------

/** Cap per run so a click can never stampede external systems. */
const BATCH_LIMIT = 40;

async function finishBatch(
  tenantId: string,
  label: string,
  counts: BatchCounts,
): Promise<PipelineActionState["counts"]> {
  const telegram = await notifyBatchSummary(`pipeline-${label}-${Date.now()}`, counts);
  const obsidian = await logBatchToObsidian(label, counts);
  await recordActivity(tenantId, {
    type: "batch_completed",
    title: `Pipeline batch "${label}": ${counts.processed} processed, ${counts.ordersCreated} orders, ${counts.awaitingApproval} awaiting approval`,
    href: "/acquisition/pipeline",
    metadata: { ...counts },
    sourceKey: `pipeline-batch:${label}:${new Date().toISOString().slice(0, 16)}`,
  });
  return { ...counts, telegram: telegram.ok ? telegram.delivered ?? "accepted" : `failed: ${telegram.error}`, obsidian };
}

export async function batchResearchAction(): Promise<PipelineActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "acquisition")) return { ok: false, error: "Admin role required." };

  const done = new Set(
    await withTenantContext(user.tenantId, async (tx) =>
      (await tx.leadResearch.findMany({ where: { tenantId: user.tenantId }, select: { leadKey: true } })).map((r) => r.leadKey),
    ),
  );
  const targets = listPipelineLeads().filter((l) => !done.has(l.name_key)).slice(0, BATCH_LIMIT);

  let researched = 0;
  for (const lead of targets) {
    const r = await researchLead(user.tenantId, lead.name_key);
    if (r.ok) researched += 1;
  }
  const counts = await finishBatch(user.tenantId, "research", {
    processed: targets.length,
    researched,
    verifiedEmails: 0,
    ordersCreated: 0,
    awaitingApproval: 0,
    sent: 0,
    failed: 0,
  });
  revalidatePipeline();
  return { ok: true, message: `Researched ${researched}/${targets.length} eligible leads.`, counts };
}

export async function batchCheckEmailsAction(): Promise<PipelineActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "update", "acquisition")) return { ok: false, error: "Admin role required." };

  const targets = listPipelineLeads().slice(0, BATCH_LIMIT * 3);
  let verified = 0;
  let notFound = 0;
  for (const lead of targets) {
    const r = await checkLeadEmail(user.tenantId, lead.name_key);
    if (r.status === "VERIFIED") verified += 1;
    if (r.status === "NOT_FOUND") notFound += 1;
  }
  const counts = await finishBatch(user.tenantId, "email-check", {
    processed: targets.length,
    researched: 0,
    verifiedEmails: verified,
    ordersCreated: 0,
    awaitingApproval: 0,
    sent: 0,
    failed: 0,
  });
  revalidatePipeline();
  return {
    ok: true,
    message: `Checked ${targets.length} leads: ${verified} verified, ${notFound} without email.`,
    counts,
  };
}

export async function batchGenerateOrdersAction(): Promise<PipelineActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "create", "acquisition")) return { ok: false, error: "Admin role required." };

  // Eligible = researched, VERIFIED email, no live order yet.
  const leads = listPipelineLeads();
  const existing = await withTenantContext(user.tenantId, async (tx) => ({
    researchKeys: new Set(
      (await tx.leadResearch.findMany({ where: { tenantId: user.tenantId }, select: { leadKey: true } })).map((r) => r.leadKey),
    ),
    liveKeys: new Set(
      (
        await tx.outreachOrder.findMany({
          where: { tenantId: user.tenantId, status: { in: ["READY_FOR_APPROVAL", "PENDING", "APPROVED", "SENT", "DELIVERED"] } },
          select: { leadKey: true },
        })
      ).map((o) => o.leadKey),
    ),
  }));

  const targets = leads
    .filter((l) => existing.researchKeys.has(l.name_key))
    .filter((l) => !existing.liveKeys.has(l.name_key))
    .filter((l) => l.email && l.verification?.toLowerCase() === "verified" && l.opted_out !== 1 && l.bounced !== 1 && !l.date_contacted && l.status.toLowerCase() === "new")
    .slice(0, BATCH_LIMIT);

  let created = 0;
  let errors = 0;
  for (const lead of targets) {
    const r = await createOutreachOrder(user.tenantId, user.userId, lead.name_key);
    if (r.ok) created += 1;
    else errors += 1;
  }

  const pending = await withTenantContext(user.tenantId, async (tx) =>
    tx.outreachOrder.count({ where: { tenantId: user.tenantId, status: { in: ["READY_FOR_APPROVAL", "PENDING"] } } }),
  );

  const counts = await finishBatch(user.tenantId, "generate", {
    processed: targets.length,
    researched: 0,
    verifiedEmails: 0,
    ordersCreated: created,
    awaitingApproval: pending,
    sent: 0,
    failed: errors,
  });
  revalidatePipeline();
  return {
    ok: true,
    message: `Created ${created} order(s) from ${targets.length} eligible lead(s); ${pending} now awaiting approval.`,
    counts,
  };
}

const queueSchema = z.object({ confirm: z.literal("yes") });

/** Queues every READY_FOR_APPROVAL order into the EXISTING Approval Queue.
 * Never sends directly — each email still needs an explicit approve. */
export async function batchQueueReadyOrdersAction(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const user = await requireUser();
  if (!can({ role: user.role }, "admin", "acquisition")) return { ok: false, error: "Owner role required to queue sends." };
  if (!queueSchema.safeParse({ confirm: str(formData, "confirm") }).success) {
    return { ok: false, error: "Confirmation required." };
  }

  const orders = await withTenantContext(user.tenantId, async (tx) =>
    tx.outreachOrder.findMany({
      where: { tenantId: user.tenantId, status: "READY_FOR_APPROVAL" },
      orderBy: { createdAt: "asc" },
      take: BATCH_LIMIT,
      select: { id: true },
    }),
  );

  let queued = 0;
  let failed = 0;
  for (const o of orders) {
    const res = await submitOrderToApproval(user.tenantId, o.id);
    if (res.ok) queued += 1;
    else failed += 1;
  }

  const counts = await finishBatch(user.tenantId, "queue", {
    processed: orders.length,
    researched: 0,
    verifiedEmails: 0,
    ordersCreated: 0,
    awaitingApproval: queued,
    sent: 0,
    failed,
  });
  revalidatePipeline();
  return {
    ok: queued > 0 || orders.length === 0,
    message:
      orders.length === 0
        ? "No orders ready to queue."
        : `Queued ${queued}/${orders.length} order(s) into the Approval Queue. Each still needs an individual approve.`,
    counts,
  };
}

function revalidatePipeline(): void {
  revalidatePath("/acquisition/pipeline");
  revalidatePath("/acquisition");
  revalidatePath("/command");
}

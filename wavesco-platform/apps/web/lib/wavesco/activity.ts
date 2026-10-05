import { withTenantContext } from "@wavesco/db";
import { listBatchManifests } from "./lead-engine";

export interface ActivityType {
  type:
    | "lead_generated"
    | "lead_verified"
    | "campaign_created"
    | "email_submitted"
    | "email_approved"
    | "email_rejected"
    | "email_sent"
    | "email_failed"
    | "reply_received"
    | "followup_created"
    | "followup_done"
    | "report_generated"
    | "report_delivered"
    | "automation_failed"
    | "generation_started"
    | "generation_completed"
    | "generation_failed"
    | "client_created"
    | "order_created"
    | "order_submitted"
    | "order_approved"
    | "order_rejected"
    | "order_sent"
    | "order_failed"
    | "order_cancelled"
    | "batch_completed"
    | "storage_upload"
    | "storage_archive"
    | "storage_missing"
    | "storage_purge"
    | "storage_delete";
}

/**
 * Records a real product activity event inside the tenant context.
 * Called by every mutating action so the Command Center stream is
 * backed exclusively by things that actually happened.
 */
export async function recordActivity(
  tenantId: string,
  event: {
    type: ActivityType["type"];
    title: string;
    entityType?: string;
    entityId?: string;
    href?: string;
    metadata?: Record<string, unknown>;
    sourceKey?: string;
  },
): Promise<void> {
  await withTenantContext(tenantId, async (tx) => {
    if (event.sourceKey) {
      const existing = await tx.activityEvent.findFirst({
        where: { tenantId, sourceKey: event.sourceKey },
        select: { id: true },
      });
      if (existing) return;
    }
    await tx.activityEvent.create({
      data: {
        tenantId,
        type: event.type,
        title: event.title,
        entityType: event.entityType,
        entityId: event.entityId,
        href: event.href,
        metadata: event.metadata as never,
        sourceKey: event.sourceKey,
      },
    });
  });
}

/**
 * Backfills activity from REAL artifacts on disk (batch manifests).
 * Idempotent via sourceKey — represents facts that already happened,
 * with the artifact's own timestamps preserved in metadata.
 */
export async function backfillBatchActivity(tenantId: string): Promise<void> {
  const manifests = (await listBatchManifests()).slice(0, 10);
  for (const m of manifests) {
    if (!m.batchId) continue;
    await recordActivity(tenantId, {
      type: "report_generated",
      title: `Lead Engine batch ${m.batchId} completed — ${m.leadCount ?? "?"} leads, ${m.emailReadyCount ?? "?"} email-ready`,
      entityType: "batch",
      entityId: m.batchId,
      href: "/acquisition/reports",
      metadata: {
        generatedAt: m.generatedAt ?? null,
        telegramDeliveryStatus: m.telegramDeliveryStatus ?? null,
        pdfPath: m.pdfPath ?? null,
        excelPath: m.excelPath ?? null,
      },
      sourceKey: `batch:${m.batchId}`,
    });
  }
}

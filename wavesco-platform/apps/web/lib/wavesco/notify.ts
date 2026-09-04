/**
 * Acquisition OS Event Hooks (client-facing notifications)
 *
 * These functions are called at REAL state transition points in the
 * Acquisition OS lifecycle. They create idempotent, tenant-scoped
 * notifications through the `@wavesco/db` engine.
 *
 * Integration pattern:
 *   When a real event happens (e.g., batch completes, campaign deploys),
 *   call the corresponding hook with the AUTHENTICATED tenantId resolved
 *   server-side. The hook checks preferences and creates notifications
 *   across enabled channels.
 *
 * IMPORTANT:
 * - Called from server-side code only (API routes, server actions, jobs).
 * - Callers MUST pass the tenant resolved from the server session
 *   (`requireSession`), never a client-supplied tenantId.
 * - Deterministic `deduplicationSuffix` values (derived from the real
 *   event identity) preserve idempotency across retries and replays.
 */

import {
  createMultiChannelNotification,
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
  type NotificationContext,
  type CreateNotificationInput,
} from "@wavesco/db";
import { withTenantContext } from "@wavesco/db";

// ─── Follow-up milestones (server-side, idempotent) ─────────────────────

/**
 * Evaluate REAL elapsed time against due follow-ups and fire the
 * time-dependent milestone notifications idempotently.
 *
 * - A pending follow-up whose `dueAt` has passed is "ready" for review
 *   (FOLLOW_UP_READY), keyed per follow-up so it fires exactly once.
 * - Once the follow-up response window (dueAt + WINDOW_MS) has fully elapsed,
 *   FOLLOW_UP_WINDOW_COMPLETED fires, keyed per follow-up.
 *
 * MUST be called from a server action / reconciliation (never from a page
 * render or a client timer). Idempotency is keyed on the real follow-up id
 * and its concrete dueAt, so repeated invocations never duplicate.
 */
export async function processDueFollowUpMilestones(
  tenantId: string,
): Promise<{ ready: number; windowsCompleted: number }> {
  const now = Date.now();
  const WINDOW_MS = 7 * 86_400_000; // 7-day follow-up response window

  const pending = await withTenantContext(tenantId, async (tx) =>
    tx.followUp.findMany({
      where: {
        tenantId,
        status: { in: ["pending", "ready"] },
      },
      select: { id: true, dueAt: true, business: true, campaignId: true },
    }),
  );

  let ready = 0;
  let windowsCompleted = 0;
  for (const f of pending) {
    const dueAtMs = new Date(f.dueAt).getTime();
    const dueKey = `fu:${f.id}:${dueAtMs}`;

    // FOLLOW_UP_READY — due time reached (this is the real time gate).
    if (dueAtMs <= now) {
      ready += 1;
      onFollowUpReady(
        tenantId,
        f.campaignId ?? undefined,
        undefined,
        { prospectName: f.business },
        undefined,
        dueKey,
      );
      await withTenantContext(tenantId, (tx) =>
        tx.followUp.updateMany({
          where: { id: f.id, status: { in: ["pending", "ready"] } },
          data: { status: "ready" },
        }),
      );
    }

    // FOLLOW_UP_WINDOW_COMPLETED — the response window has fully elapsed.
    if (dueAtMs + WINDOW_MS <= now) {
      windowsCompleted += 1;
      onFollowUpWindowCompleted(
        tenantId,
        f.campaignId ?? f.id,
        undefined,
        undefined,
        `${dueKey}:window`,
      );
      await withTenantContext(tenantId, (tx) =>
        tx.followUp.updateMany({
          where: { id: f.id, status: { in: ["pending", "ready"] } },
          data: { status: "completed" },
        }),
      );
    }
  }

  return { ready, windowsCompleted };
}

// ─── Helper: Fire and Forget ──────────────────────────────────────────

/**
 * Create notification(s) without blocking the caller.
 *
 * HARD GUARANTEE: a notification failure can NEVER fail the lifecycle
 * transition that fired it. Everything is deferred to a microtask and
 * guarded — synchronous import/ wiring errors and async DB errors are both
 * contained and logged. The lifecycle operation proceeds regardless.
 */
function fireNotification(
  input: CreateNotificationInput,
): void {
  if (!input?.eventType) {
    // Never fabricate: an unresolvable event type is logged and skipped.
    console.error(
      JSON.stringify({
        event: "notification.skipped_invalid_event",
        tenantId: input?.tenantId,
      }),
    );
    return;
  }
  try {
    void Promise.resolve()
      .then(() => createMultiChannelNotification(input))
      .catch((err: unknown) => {
        console.error(
          JSON.stringify({
            event: "notification.create_failed",
            eventType: input.eventType,
            tenantId: input.tenantId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
  } catch (err) {
    // Contain even synchronous failures (e.g. wiring/import errors).
    console.error(
      JSON.stringify({
        event: "notification.enqueue_failed",
        eventType: input.eventType,
        tenantId: input.tenantId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ─── Cycle Hooks ──────────────────────────────────────────────────────

export function onCycleStarted(
  tenantId: string,
  cycleId: string | undefined,
  userId?: string,
  deduplicationSuffix?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.CYCLE_STARTED,
    cycleId,
    context: { cycleId },
    deduplicationSuffix,
  });
}

export function onLeadGenerationCompleted(
  tenantId: string,
  cycleId: string | undefined,
  context: NotificationContext,
  userId?: string,
  deduplicationSuffix?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.LEAD_GENERATION_COMPLETED,
    cycleId,
    context,
    deduplicationSuffix,
  });
}

export function onLeadReportReady(
  tenantId: string,
  cycleId: string | undefined,
  context: NotificationContext,
  userId?: string,
  deduplicationSuffix?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.LEAD_REPORT_READY,
    cycleId,
    context,
    deduplicationSuffix,
  });
}

export function onCycleReportReady(
  tenantId: string,
  cycleId: string | undefined,
  context: NotificationContext,
  userId?: string,
  deduplicationSuffix?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.CYCLE_REPORT_READY,
    cycleId,
    context,
    deduplicationSuffix,
  });
}

// ─── Campaign Hooks ───────────────────────────────────────────────────

export function onEmailsReadyForReview(
  tenantId: string,
  campaignId: string | undefined,
  cycleId: string | undefined,
  context: NotificationContext,
  userId?: string,
  deduplicationSuffix?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.EMAILS_READY_FOR_REVIEW,
    campaignId,
    cycleId,
    context,
    deduplicationSuffix,
  });
}

export function onCampaignDeployed(
  tenantId: string,
  campaignId: string | undefined,
  cycleId: string | undefined,
  context: NotificationContext,
  userId?: string,
  deduplicationSuffix?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.CAMPAIGN_DEPLOYED,
    campaignId,
    cycleId,
    context,
    deduplicationSuffix,
  });
}

export function onFollowUpReady(
  tenantId: string,
  campaignId: string | undefined,
  cycleId: string | undefined,
  context: NotificationContext,
  userId?: string,
  deduplicationSuffix?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.FOLLOW_UP_READY,
    campaignId,
    cycleId,
    context,
    deduplicationSuffix,
  });
}

export function onFollowUpWindowCompleted(
  tenantId: string,
  campaignId: string,
  cycleId: string | undefined,
  userId?: string,
  deduplicationSuffix?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.FOLLOW_UP_WINDOW_COMPLETED,
    campaignId,
    cycleId,
    deduplicationSuffix,
  });
}

export function onCampaignResultsFinalized(
  tenantId: string,
  campaignId: string,
  cycleId: string | undefined,
  context: NotificationContext,
  userId?: string,
  deduplicationSuffix?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.CAMPAIGN_RESULTS_FINALIZED,
    campaignId,
    cycleId,
    context,
    deduplicationSuffix,
  });
}

// ─── Response Hooks ───────────────────────────────────────────────────

/**
 * New responses detected at a REAL reply event.
 *
 * `deduplicationSuffix` MUST be deterministic and derived from the real
 * reply identity (e.g. `reply:${orderId}:${replyStatus}`) so a retried or
 * replayed event never produces a duplicate notification.
 */
export function onNewResponsesDetected(
  tenantId: string,
  campaignId: string | undefined,
  cycleId: string | undefined,
  context: NotificationContext,
  deduplicationSuffix: string,
  userId?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.NEW_RESPONSES_DETECTED,
    campaignId,
    cycleId,
    context,
    deduplicationSuffix,
  });
}

/**
 * Positive response detected at a REAL reply classification event.
 *
 * `prospectKey` is the deterministic per-prospect idempotency suffix so the
 * same prospect's positive reply never triggers duplicate notifications.
 */
export function onPositiveResponseDetected(
  tenantId: string,
  campaignId: string | undefined,
  cycleId: string | undefined,
  context: NotificationContext,
  prospectKey: string,
  userId?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.POSITIVE_RESPONSE_DETECTED,
    campaignId,
    cycleId,
    context,
    deduplicationSuffix: prospectKey,
  });
}

// ─── Error Hooks ──────────────────────────────────────────────────────

export function onStorageConnectionError(
  tenantId: string,
  userId?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.STORAGE_CONNECTION_ERROR,
    deduplicationSuffix: `storage-error-${Math.floor(Date.now() / 300_000)}`, // Dedup within 5min window
  });
}

export function onEmailConnectionError(
  tenantId: string,
  userId?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.EMAIL_CONNECTION_ERROR,
    deduplicationSuffix: `email-error-${Math.floor(Date.now() / 300_000)}`,
  });
}

export function onCampaignHalted(
  tenantId: string,
  campaignId: string,
  cycleId: string | undefined,
  userId?: string,
) {
  fireNotification({
    tenantId,
    userId,
    eventType: NOTIFICATION_EVENT_TYPES.CAMPAIGN_HALTED,
    campaignId,
    cycleId,
    deduplicationSuffix: `halted-${campaignId}`,
  });
}

// ─── Generic Hook ─────────────────────────────────────────────────────

/**
 * Fire a notification for any event type.
 * Use when the specific hook above doesn't cover the case.
 */
export function onNotificationEvent(
  tenantId: string,
  eventType: NotificationEventType,
  context: NotificationContext & {
    cycleId?: string;
    campaignId?: string;
    userId?: string;
    deduplicationSuffix?: string;
  },
) {
  const { userId, cycleId, campaignId, deduplicationSuffix, ...notifContext } =
    context;

  fireNotification({
    tenantId,
    userId,
    eventType,
    cycleId,
    campaignId,
    context: notifContext,
    deduplicationSuffix,
  });
}

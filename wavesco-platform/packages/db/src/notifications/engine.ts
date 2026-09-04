/**
 * Acquisition OS Notification Engine
 *
 * Creates notifications idempotently. A single milestone event produces
 * exactly one notification per intended recipient/channel, regardless of
 * worker retries, webhook retries, page refreshes, or event replays.
 *
 * Architecture:
 *   Acquisition Event → Notification Engine → Notification Preferences → Channel Delivery
 *
 * Tenant isolation: every operation runs inside `withTenantContext(tenantId, …)`,
 * which sets the RLS `app.tenant_id` for the transaction. The caller must pass
 * the authenticated tenant (never trust a client-supplied tenantId).
 */

import { Prisma } from "../generated/client";
import { withTenantContext } from "../rls";
import {
  EVENT_TO_CATEGORY,
  NOTIFICATION_CHANNELS as CHANNELS,
  type NotificationChannel,
  type NotificationContext,
  type NotificationEventType,
} from "./types";
import {
  buildIdempotencyKey,
  resolveNotificationContent,
  resolveResourceHref,
  resolveResourceType,
} from "./pure";

// ─── Core: Create Notification ────────────────────────────────────────

export interface CreateNotificationInput {
  tenantId: string;
  userId?: string;
  eventType: NotificationEventType;
  cycleId?: string;
  campaignId?: string;
  context?: NotificationContext;
  /** Optional suffix to allow multiple distinct notifications for the same event type */
  deduplicationSuffix?: string;
  /** Override channel. Defaults to in_app */
  channel?: NotificationChannel;
  /** Additional metadata to store */
  metadata?: Record<string, unknown>;
}

export interface CreateNotificationResult {
  created: boolean;
  notificationId: string | null;
}

/**
 * Create a notification idempotently.
 *
 * Returns { created: true, notificationId } if a new notification was created,
 * or { created: false, notificationId: existingId } if a duplicate was detected.
 *
 * This is safe to call multiple times for the same logical event.
 * Runs inside withTenantContext so RLS enforces tenant isolation.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<CreateNotificationResult> {
  const {
    tenantId,
    userId,
    eventType,
    cycleId,
    campaignId,
    context = {},
    deduplicationSuffix,
    channel = CHANNELS.IN_APP,
    metadata,
  } = input;

  const idempotencyKey = buildIdempotencyKey(
    tenantId,
    eventType,
    cycleId,
    campaignId,
    channel,
    deduplicationSuffix,
  );

  const { title, message } = resolveNotificationContent(eventType, context);
  const resourceHref = resolveResourceHref(eventType, context);
  const resourceType = resolveResourceType(eventType);

  try {
    return await withTenantContext(tenantId, async (tx) => {
      // Idempotent upsert: if the key exists, return existing
      const existing = await tx.notification.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });

      if (existing) {
        return { created: false, notificationId: existing.id };
      }

      const notification = await tx.notification.create({
        data: {
          tenantId,
          userId: userId ?? null,
          eventType,
          title,
          message,
          cycleId: cycleId ?? null,
          campaignId: campaignId ?? null,
          resourceType: resourceType ?? null,
          resourceId: campaignId ?? cycleId ?? null,
          resourceHref: resourceHref ?? null,
          channel,
          read: false,
          delivered: channel === CHANNELS.IN_APP, // in_app is immediately "delivered"
          deliveredAt: channel === CHANNELS.IN_APP ? new Date() : null,
          idempotencyKey,
          metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        select: { id: true },
      });

      return { created: true, notificationId: notification.id };
    });
  } catch (err: unknown) {
    // Handle unique constraint race condition
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      // Unique constraint violation = already exists
      const existing = await withTenantContext(tenantId, async (tx) =>
        tx.notification.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        }),
      );
      return { created: false, notificationId: existing?.id ?? null };
    }
    throw err;
  }
}

// ─── Convenience: Create for Multiple Channels ────────────────────────

/**
 * Create notifications across all enabled channels for a tenant.
 * Checks NotificationPreference to determine which channels are enabled.
 */
export async function createMultiChannelNotification(
  input: CreateNotificationInput,
): Promise<CreateNotificationResult[]> {
  const { tenantId, eventType } = input;
  const category = EVENT_TO_CATEGORY[eventType];

  // Fetch preferences for this category
  const preferences = await withTenantContext(tenantId, async (tx) =>
    tx.notificationPreference.findMany({
      where: { tenantId, category },
      select: { channel: true, enabled: true },
    }),
  );

  // Truthful channel gating: only channels with a REAL delivery path may
  // create rows. In-app is the only implemented delivery today (the
  // notification center renders these rows). Email delivery is NOT
  // implemented — creating 'email' rows would fabricate delivery the client
  // can never receive. Add CHANNELS.EMAIL to DELIVERABLE_CHANNELS only when
  // a real email sender is wired into this engine.
  const DELIVERABLE_CHANNELS: readonly string[] = [CHANNELS.IN_APP];

  const enabledChannels = new Set<string>();
  const inAppExplicitlyDisabled = preferences.some(
    (p) => p.channel === CHANNELS.IN_APP && !p.enabled,
  );
  if (!inAppExplicitlyDisabled) {
    enabledChannels.add(CHANNELS.IN_APP);
  }
  for (const pref of preferences) {
    if (pref.enabled && DELIVERABLE_CHANNELS.includes(pref.channel)) {
      enabledChannels.add(pref.channel);
    }
  }

  const results: CreateNotificationResult[] = [];

  for (const channel of enabledChannels) {
    const result = await createNotification({
      ...input,
      channel: channel as NotificationChannel,
    });
    results.push(result);
  }

  return results;
}

// ─── Mark as Read ─────────────────────────────────────────────────────

export async function markNotificationRead(
  tenantId: string,
  notificationId: string,
): Promise<boolean> {
  const updated = await withTenantContext(
    tenantId,
    async (tx) =>
      tx.notification.updateMany({
        where: {
          id: notificationId,
          tenantId,
          read: false,
        },
        data: {
          read: true,
          readAt: new Date(),
        },
      }),
  );

  return updated.count > 0;
}

export async function markAllNotificationsRead(
  tenantId: string,
): Promise<number> {
  const updated = await withTenantContext(
    tenantId,
    async (tx) =>
      tx.notification.updateMany({
        where: {
          tenantId,
          read: false,
        },
        data: {
          read: true,
          readAt: new Date(),
        },
      }),
  );

  return updated.count;
}

// ─── Query Notifications ──────────────────────────────────────────────

export interface ListNotificationsOptions {
  tenantId: string;
  userId?: string;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
  eventType?: NotificationEventType;
}

export async function listNotifications(options: ListNotificationsOptions) {
  const {
    tenantId,
    userId,
    unreadOnly = false,
    limit = 50,
    offset = 0,
    eventType,
  } = options;

  return withTenantContext(tenantId, async (tx) => {
    const where: Record<string, unknown> = { tenantId };
    if (userId) where.userId = userId;
    if (unreadOnly) where.read = false;
    if (eventType) where.eventType = eventType;
    // In-app surface only: email/push rows are channel abstractions until a
    // real sender exists — never present undelivered channel rows as in-app items.
    where.channel = "in_app";

    const [notifications, total, unreadCount] = await Promise.all([
      tx.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          eventType: true,
          title: true,
          message: true,
          cycleId: true,
          campaignId: true,
          resourceType: true,
          resourceId: true,
          resourceHref: true,
          channel: true,
          read: true,
          readAt: true,
          createdAt: true,
          metadata: true,
        },
      }),
      tx.notification.count({ where }),
      tx.notification.count({ where: { tenantId, read: false } }),
    ]);

    return { notifications, total, unreadCount };
  });
}

// ─── Get Single Notification ──────────────────────────────────────────

export async function getNotification(
  tenantId: string,
  notificationId: string,
) {
  return withTenantContext(tenantId, async (tx) =>
    tx.notification.findFirst({
      where: { id: notificationId, tenantId },
      select: {
        id: true,
        eventType: true,
        title: true,
        message: true,
        cycleId: true,
        campaignId: true,
        resourceType: true,
        resourceId: true,
        resourceHref: true,
        channel: true,
        read: true,
        readAt: true,
        delivered: true,
        deliveredAt: true,
        createdAt: true,
        metadata: true,
      },
    }),
  );
}

/**
 * Pure (DB-free) notification logic.
 *
 * These functions are deterministic and testable without a database.
 * The engine uses them to build idempotency keys and resolve content.
 */

import {
  NOTIFICATION_TEMPLATES,
  EVENT_TO_RESOURCE_TYPE,
  type NotificationEventType,
  type NotificationChannel,
  type NotificationContext,
} from "./types";

/**
 * Build a deterministic idempotency key.
 *
 * Two calls with the same (tenant, eventType, cycleId, campaignId, channel,
 * suffix) produce the same key → the engine deduplicates correctly.
 */
export function buildIdempotencyKey(
  tenantId: string,
  eventType: NotificationEventType,
  cycleId: string | undefined,
  campaignId: string | undefined,
  channel: NotificationChannel,
  deduplicationSuffix?: string,
): string {
  const parts = [
    "notif",
    tenantId,
    eventType,
    cycleId ?? "none",
    campaignId ?? "none",
    channel,
    deduplicationSuffix ?? "default",
  ];
  return parts.join(":");
}

/**
 * Resolve notification title + body from event type and context.
 */
export function resolveNotificationContent(
  eventType: NotificationEventType,
  context: NotificationContext,
): { title: string; message: string } {
  const template = NOTIFICATION_TEMPLATES[eventType];
  if (!template) {
    throw new Error(`Unknown notification event type: ${eventType}`);
  }

  const message =
    typeof template.message === "function"
      ? template.message(context)
      : template.message;

  return { title: template.title, message };
}

/**
 * Resolve the client-facing resource href for a notification, if any.
 */
export function resolveResourceHref(
  eventType: NotificationEventType,
  context: NotificationContext,
): string | null {
  const template = NOTIFICATION_TEMPLATES[eventType];
  if (!template?.resourceHref) return null;
  return template.resourceHref(context);
}

/**
 * Resolve the resource type for a notification, if any.
 */
export function resolveResourceType(
  eventType: NotificationEventType,
): string | null {
  return EVENT_TO_RESOURCE_TYPE[eventType] ?? null;
}

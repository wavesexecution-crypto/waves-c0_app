/**
 * Acquisition OS Notification System — engine layer (package `@wavesco/db`).
 *
 * Channel-agnostic, idempotent, tenant-scoped. Higher-level hooks and the
 * email template live in the web app (`lib/wavesco/notify.ts`).
 */

export {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_CHANNELS,
  PREFERENCE_CATEGORIES,
  EVENT_TO_CATEGORY,
  EVENT_TO_RESOURCE_TYPE,
  NOTIFICATION_TEMPLATES,
  RESOURCE_TYPES,
  type NotificationEventType,
  type NotificationChannel,
  type NotificationContext,
  type NotificationTemplate,
  type PreferenceCategory,
  type ResourceType,
} from "./types";

export {
  buildIdempotencyKey,
  resolveNotificationContent,
  resolveResourceHref,
  resolveResourceType,
} from "./pure";

export {
  createNotification,
  createMultiChannelNotification,
  markNotificationRead,
  markAllNotificationsRead,
  listNotifications,
  getNotification,
  type CreateNotificationInput,
  type CreateNotificationResult,
  type ListNotificationsOptions,
} from "./engine";

export {
  ensureDefaultPreferences,
  getPreferences,
  updatePreference,
  updatePreferences,
  isChannelEnabled,
  type NotificationPreferencesResult,
  type PreferenceUpdate,
} from "./preferences";

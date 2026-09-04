/**
 * Notification Preferences Management
 *
 * Manages per-tenant notification channel preferences.
 * Each category (cycle_milestones, reports, etc.) can be enabled/disabled
 * per channel (in_app, email, push).
 *
 * All operations run inside `withTenantContext` so RLS enforces tenant isolation.
 */

import { withTenantContext } from "../rls";
import {
  PREFERENCE_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type PreferenceCategory,
  type NotificationChannel,
} from "./types";

// ─── Default Preferences ──────────────────────────────────────────────

const DEFAULT_PREFERENCES: Array<{
  category: PreferenceCategory;
  channel: NotificationChannel;
  enabled: boolean;
}> = [
  // Cycle milestones
  { category: "cycle_milestones", channel: "in_app", enabled: true },
  { category: "cycle_milestones", channel: "email", enabled: false },
  { category: "cycle_milestones", channel: "push", enabled: true },
  // Reports
  { category: "reports", channel: "in_app", enabled: true },
  { category: "reports", channel: "email", enabled: false },
  { category: "reports", channel: "push", enabled: true },
  // Campaign activity
  { category: "campaign_activity", channel: "in_app", enabled: true },
  { category: "campaign_activity", channel: "email", enabled: false },
  { category: "campaign_activity", channel: "push", enabled: true },
  // Responses
  { category: "responses", channel: "in_app", enabled: true },
  { category: "responses", channel: "email", enabled: false },
  { category: "responses", channel: "push", enabled: true },
  // Action required
  { category: "action_required", channel: "in_app", enabled: true },
  { category: "action_required", channel: "email", enabled: false },
  { category: "action_required", channel: "push", enabled: true },
];

// ─── Initialize Defaults ──────────────────────────────────────────────

/**
 * Ensure default notification preferences exist for a tenant.
 * Called during tenant provisioning or first notification access.
 */
export async function ensureDefaultPreferences(
  tenantId: string,
): Promise<void> {
  await withTenantContext(tenantId, async (tx) => {
    const existing: { category: string; channel: string }[] =
      await tx.notificationPreference.findMany({
        where: { tenantId },
        select: { category: true, channel: true },
      });

    const existingSet = new Set(
      existing.map((e) => `${e.category}:${e.channel}`),
    );

    const toCreate = DEFAULT_PREFERENCES.filter(
      (p) => !existingSet.has(`${p.category}:${p.channel}`),
    );

    if (toCreate.length > 0) {
      await tx.notificationPreference.createMany({
        data: toCreate.map((p) => ({
          tenantId,
          category: p.category,
          channel: p.channel,
          enabled: p.enabled,
        })),
      });
    }
  });
}

// ─── Get Preferences ──────────────────────────────────────────────────

export interface NotificationPreferencesResult {
  category: string;
  channels: Array<{
    channel: string;
    enabled: boolean;
  }>;
}

export async function getPreferences(
  tenantId: string,
): Promise<NotificationPreferencesResult[]> {
  await ensureDefaultPreferences(tenantId);

  const prefs = await withTenantContext(tenantId, async (tx) =>
    tx.notificationPreference.findMany({
      where: { tenantId },
      orderBy: [{ category: "asc" }, { channel: "asc" }],
    }),
  );

  // Group by category
  const grouped = new Map<string, Array<{ channel: string; enabled: boolean }>>();

  for (const pref of prefs) {
    const existing = grouped.get(pref.category) ?? [];
    existing.push({ channel: pref.channel, enabled: pref.enabled });
    grouped.set(pref.category, existing);
  }

  return Array.from(grouped.entries()).map(([category, channels]) => ({
    category,
    channels,
  }));
}

// ─── Update Preference ────────────────────────────────────────────────

export async function updatePreference(
  tenantId: string,
  category: PreferenceCategory,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<void> {
  await withTenantContext(tenantId, async (tx) =>
    tx.notificationPreference.upsert({
      where: {
        tenantId_category_channel: {
          tenantId,
          category,
          channel,
        },
      },
      create: {
        tenantId,
        category,
        channel,
        enabled,
      },
      update: {
        enabled,
      },
    }),
  );
}

// ─── Bulk Update ──────────────────────────────────────────────────────

export interface PreferenceUpdate {
  category: PreferenceCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

export async function updatePreferences(
  tenantId: string,
  updates: PreferenceUpdate[],
): Promise<void> {
  await ensureDefaultPreferences(tenantId);

  for (const update of updates) {
    await updatePreference(
      tenantId,
      update.category,
      update.channel,
      update.enabled,
    );
  }
}

// ─── Check if Channel Enabled ─────────────────────────────────────────

/**
 * Check if a specific notification channel is enabled for a tenant's category.
 * Returns true by default if no preference exists (fail-open for in_app).
 */
export async function isChannelEnabled(
  tenantId: string,
  category: PreferenceCategory,
  channel: NotificationChannel,
): Promise<boolean> {
  // in_app is always enabled
  if (channel === NOTIFICATION_CHANNELS.IN_APP) return true;

  const pref = await withTenantContext(tenantId, async (tx) =>
    tx.notificationPreference.findUnique({
      where: {
        tenantId_category_channel: {
          tenantId,
          category,
          channel,
        },
      },
      select: { enabled: true },
    }),
  );

  // Default: disabled for non-in_app channels when no preference exists
  return pref?.enabled ?? false;
}

/**
 * Email operating mode (client-facing choice, tenant-scoped).
 *
 * Acquisition OS supports two email operating modes that feed the SAME
 * campaign lifecycle (send → monitor → reply → follow-up):
 *
 *  - `waves_managed`  (default, launch path): Waves operates the outbound
 *    infrastructure (n8n Email Outbox + SMTP relay). The client never
 *    configures a mail server.
 *  - `client_managed` (recorded preference): the client wants their own
 *    mailbox used. Until a client-managed connector is provisioned for the
 *    tenant (concierge setup), delivery CONTINUES through Waves-managed
 *    infrastructure — the mode is stored and surfaced as `setup_pending`,
 *    never faked as active.
 *
 * The mode persists inside `AcquisitionProfile.integrations` JSON
 * (existing tenant config field — no schema change), flows into agent
 * context via `ai-context.ts`, and is redacted by the platform's secret
 * redaction like the rest of that section.
 */

export const EMAIL_MODES = ["waves_managed", "client_managed"] as const;

export type EmailMode = (typeof EMAIL_MODES)[number];

export const DEFAULT_EMAIL_MODE: EmailMode = "waves_managed";

export function isEmailMode(v: unknown): v is EmailMode {
  return typeof v === "string" && (EMAIL_MODES as readonly string[]).includes(v);
}

/** Read + validate the mode from a tenant's integrations JSON (never throws). */
export function readEmailMode(integrations: unknown): EmailMode {
  if (integrations && typeof integrations === "object") {
    const candidate = (integrations as Record<string, unknown>).emailMode;
    if (isEmailMode(candidate)) return candidate;
  }
  return DEFAULT_EMAIL_MODE;
}

/** Merge a mode into an existing integrations JSON without losing keys. */
export function withEmailMode(
  integrations: unknown,
  mode: EmailMode,
): Record<string, unknown> {
  const base =
    integrations && typeof integrations === "object"
      ? { ...(integrations as Record<string, unknown>) }
      : {};
  return { ...base, emailMode: mode };
}

/** Client-facing copy for a mode (no internal infrastructure terms). */
export function emailModeLabel(mode: EmailMode): string {
  return mode === "waves_managed"
    ? "Waves handles email"
    : "Use our email system";
}

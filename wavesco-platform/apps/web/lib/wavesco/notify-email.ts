/**
 * Email Notification Template
 *
 * WavesCo-branded HTML email for Acquisition OS milestones.
 * Used by the email notification channel when delivering notifications.
 *
 * Does NOT attach reports — directs the client back to Acquisition OS.
 */

import type { NotificationEventType } from "@wavesco/db";

export interface EmailNotificationData {
  title: string;
  message: string;
  eventType: NotificationEventType;
  actionHref?: string;
  actionLabel?: string;
  cycleId?: string;
  campaignId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Generate WavesCo-branded HTML email for a notification.
 */
export function renderNotificationEmail(data: EmailNotificationData): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.wavesco.in";
  const actionUrl = data.actionHref
    ? `${appUrl}${data.actionHref}`
    : `${appUrl}/acquisition`;

  const actionLabel = data.actionLabel ?? "View Details";

  const contextLines: string[] = [];
  if (data.metadata?.leadCount && data.metadata?.qualifiedCount) {
    contextLines.push(
      `<tr><td style="padding:4px 0;font-size:13px;color:#4a5568;">${data.metadata.leadCount} businesses researched</td></tr>`,
      `<tr><td style="padding:4px 0;font-size:13px;color:#4a5568;">${data.metadata.qualifiedCount} qualified leads</td></tr>`,
    );
  }
  if (data.metadata?.emailCount) {
    contextLines.push(
      `<tr><td style="padding:4px 0;font-size:13px;color:#4a5568;">${data.metadata.emailCount} personalized emails</td></tr>`,
    );
  }
  if (data.metadata?.responseCount) {
    contextLines.push(
      `<tr><td style="padding:4px 0;font-size:13px;color:#4a5568;">${data.metadata.responseCount} new responses</td></tr>`,
    );
  }

  const contextHtml =
    contextLines.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;">${contextLines.join("")}</table>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${data.title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f7f9fb;font-family:'IBM Plex Sans',Inter,ui-sans-serif,system-ui,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f7f9fb;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:8px;border:1px solid #d1d5db;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color:#0a1f44;padding:24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.12em;text-transform:uppercase;font-family:'General Sans',Inter,sans-serif;">WAVES</span>
                    <span style="display:inline-block;width:1px;height:16px;background:rgba(255,255,255,0.3);vertical-align:middle;margin:0 12px;"></span>
                    <span style="font-size:10px;color:rgba(255,255,255,0.6);letter-spacing:0.2em;text-transform:uppercase;font-family:'IBM Plex Mono',monospace;">ACQUISITION OS</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <!-- Title -->
              <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0a1f44;line-height:1.3;">
                ${escapeHtml(data.title)}
              </h1>

              <!-- Message -->
              <p style="margin:0 0 20px 0;font-size:14px;color:#4a5568;line-height:1.6;">
                ${escapeHtml(data.message)}
              </p>

              <!-- Context stats -->
              ${contextHtml}

              <!-- Action Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
                <tr>
                  <td>
                    <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background-color:#00c2d1;color:#06142e;font-size:13px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:2px;letter-spacing:0.02em;">
                      ${escapeHtml(actionLabel)}&nbsp;→
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f7f9fb;border-top:1px solid #d1d5db;padding:20px 32px;">
              <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;text-align:center;">
                This is an automated update from your Acquisition OS.
                <br/>
                <a href="${escapeHtml(actionUrl)}" style="color:#00c2d1;text-decoration:none;">Open Acquisition OS</a>
                &nbsp;·&nbsp;
                <a href="${appUrl}/notifications/preferences" style="color:#00c2d1;text-decoration:none;">Notification Settings</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Get the email subject line for a notification.
 */
export function getNotificationEmailSubject(
  _eventType: NotificationEventType,
  title: string,
): string {
  return `Waves Acquisition OS — ${title}`;
}

/**
 * Get the appropriate action label for a notification type.
 */
export function getNotificationActionLabel(
  eventType: NotificationEventType,
): string {
  const labels: Partial<Record<NotificationEventType, string>> = {
    CYCLE_STARTED: "Open Cycle",
    LEAD_GENERATION_COMPLETED: "View Leads",
    LEAD_REPORT_READY: "View Report",
    EMAILS_READY_FOR_REVIEW: "Review Emails",
    CAMPAIGN_DEPLOYED: "View Campaign",
    NEW_RESPONSES_DETECTED: "View Responses",
    POSITIVE_RESPONSE_DETECTED: "View Response",
    FOLLOW_UP_READY: "Review Follow-ups",
    FOLLOW_UP_WINDOW_COMPLETED: "View Campaign",
    CAMPAIGN_RESULTS_FINALIZED: "View Results",
    CYCLE_REPORT_READY: "View Report",
  };
  return labels[eventType] ?? "View Details";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

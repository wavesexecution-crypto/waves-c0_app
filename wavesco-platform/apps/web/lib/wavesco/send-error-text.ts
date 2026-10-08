/**
 * Client language for send failures (UI-only, no backend change).
 *
 * Provider-side and transport failures (unverified sending domain, missing
 * bridge, unreachable worker) are WAVES-side concerns — the client can't
 * act on them, so they read as plain status. Per-email reasons (bad
 * address, mailbox full) pass through verbatim because the client CAN
 * act on those.
 */
export function plainSendError(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (/resend|brevo|sendgrid|domain.{0,24}verif|smtp/i.test(text)) {
    return "Email sending isn't connected on the WAVES side yet — this email stays queued, nothing is lost.";
  }
  if (/^(webhook \d+|network\b.*|.*\b(unreachable|ECONNREFUSED|ETIMEDOUT|fetch failed|no_base_url)\b.*)$/i.test(text)) {
    return "Couldn't reach the sending service just now — this email stays queued, nothing is lost.";
  }
  return text;
}

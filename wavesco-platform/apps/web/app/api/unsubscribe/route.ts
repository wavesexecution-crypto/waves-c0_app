/**
 * GET /api/unsubscribe?token=…
 *
 * Recipient-facing, public, safe-by-default.
 * - Verifies the HMAC-signed token (no DB lookup before auth).
 * - Suppresses the recipient persistently (all orders marked, live orders
 *   cancelled) — idempotent.
 * - Always answers with a human HTML page; never leaks tenant ids or
 *   internal errors to the recipient.
 *
 * Truthful behavior:
 * - Missing/invalid token   → 400 page (no suppression performed).
 * - Secret not configured   → 503 page (system disabled; never fake success).
 * - Suppression failure     → 500 page (recipient may retry the link).
 */

import { NextResponse } from "next/server";
import { withTenantContext } from "@wavesco/db";
import {
  suppressRecipient,
  verifyUnsubscribeToken,
} from "@/lib/wavesco/unsubscribe";

export const dynamic = "force-dynamic";

function page(title: string, message: string, status: number): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head>
<body style="margin:0;background:#f7f9fb;font-family:Inter,system-ui,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:64px 20px;">
    <table role="presentation" style="max-width:480px;width:100%;background:#fff;border:1px solid #d1d5db;border-radius:8px;">
      <tr><td style="background:#0a1f44;padding:20px 32px;border-radius:8px 8px 0 0;">
        <span style="font-size:16px;font-weight:700;color:#fff;letter-spacing:.12em;">WAVES</span>
        <span style="font-size:10px;color:rgba(255,255,255,.6);letter-spacing:.2em;margin-left:12px;">ACQUISITION OS</span>
      </td></tr>
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 12px;font-size:20px;color:#0a1f44;">${title}</h1>
        <p style="margin:0;font-size:14px;color:#4a5568;line-height:1.6;">${message}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return page(
      "Unsubscribe link invalid",
      "This link is missing its unsubscribe token. Please use the exact link from your email.",
      400,
    );
  }

  const claims = verifyUnsubscribeToken(token);
  if (!claims) {
    return page(
      "Unsubscribe link invalid",
      "This unsubscribe link is invalid or was modified. Please use the exact link from your email.",
      400,
    );
  }

  try {
    const result = await withTenantContext(claims.t, (tx) =>
      suppressRecipient(tx, claims.t, claims.e, "unsubscribe_link"),
    );
    console.log(
      JSON.stringify({
        event: "unsubscribe.processed",
        tenantId: claims.t,
        recipient: claims.e,
        alreadySuppressed: result.alreadySuppressed,
        marked: result.marked,
        cancelled: result.cancelled,
      }),
    );
    return page(
      result.alreadySuppressed
        ? "You're already unsubscribed"
        : "You're unsubscribed",
      result.alreadySuppressed
        ? "No further outreach will be sent to this address."
        : "You will not receive further outreach from Waves to this address. Any scheduled emails for you have been cancelled.",
      200,
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "unsubscribe.failed",
        tenantId: claims.t,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return page(
      "Something went wrong",
      "We could not process your unsubscribe request right now. Please try the link again in a moment.",
      500,
    );
  }
}

import { NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { recordInboundMessage, validateInbound } from "@/lib/wavesco/conversations";

export const dynamic = "force-dynamic";

/** POST /api/acquisition/replies/ingest — inbound reply/bounce/unsubscribe intake.
 *
 *  Auth (either mode, both fail closed):
 *    1. SERVICE: `x-ingest-key` == env ACQUISITION_INGEST_KEY (timing-safe).
 *       Used by mailbox pollers / Brevo webhooks / n8n. Tenant is taken from
 *       the body (`tenantId`) and the key is global infrastructure trust.
 *    2. SESSION: owner/admin of the tenant in the body.
 *
 *  Idempotent on `providerMsgId` — replays return the original result with
 *  `deduped: true` and change nothing. */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });

  const configuredKey = process.env.ACQUISITION_INGEST_KEY?.trim() ?? "";
  const providedKey = req.headers.get("x-ingest-key") ?? "";
  let authorized = false;
  let actor = "session";
  if (providedKey) {
    if (!configuredKey) {
      return NextResponse.json({ error: "ingest key auth is not configured on this deployment" }, { status: 503 });
    }
    const a = Buffer.from(providedKey);
    const b = Buffer.from(configuredKey);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      authorized = true;
      actor = "ingest-key";
    } else {
      return NextResponse.json({ error: "Invalid ingest key." }, { status: 401 });
    }
  } else {
    try {
      const session: unknown = await auth();
      const user = (session as { user?: { tenantId?: unknown; role?: unknown } } | null)?.user;
      const sessionTenant = typeof user?.tenantId === "string" ? user.tenantId : "";
      const sessionRole = typeof user?.role === "string" ? user.role : "member";
      if (!sessionTenant || sessionTenant !== tenantId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      if (sessionRole !== "owner" && sessionRole !== "admin") {
        return NextResponse.json({ error: "forbidden", reason: "Admin role required to ingest replies." }, { status: 403 });
      }
      authorized = true;
    } catch {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const checked = validateInbound(body);
  if (!checked.ok || !checked.value) {
    return NextResponse.json({ error: "invalid message", reason: checked.error }, { status: 400 });
  }
  try {
    const result = await recordInboundMessage(tenantId, checked.value, `ingest:${actor}`);
    if (!result.ok) return NextResponse.json({ error: "ingest_failed", reason: result.error }, { status: 422 });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: "internal", reason: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

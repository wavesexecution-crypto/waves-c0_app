import { NextResponse } from "next/server";
import { requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { hasAccess, transitionEntitlement } from "@/lib/wavesco/entitlements";

export const dynamic = "force-dynamic";

const VALID = ["suspend", "resume", "cancel", "refund", "renew"] as const;

/** POST /api/acquisition/entitlement/transition — suspend/resume/cancel/refund/renew.
 *  Owner only. Deliberately NOT entitlement-gated: resume/renew/cancel must
 *  work from expired/suspended states. Invalid transitions return 400 with
 *  the exact reason (never silent). */
export async function POST(req: Request) {
  let tenantId: string;
  let userId: string | null | undefined;
  let role: string;
  try {
    const auth = await requireControlAuth();
    tenantId = auth.tenantId;
    userId = auth.userId;
    role = sessionRole(auth.session);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (role !== "owner") {
    return NextResponse.json(
      { error: "forbidden", reason: "Owner role required to change access state." },
      { status: 403 },
    );
  }
  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!(VALID as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "invalid action", valid: VALID, received: action || null }, { status: 400 });
  }
  try {
    const { entitlement } = await transitionEntitlement(
      tenantId,
      action as (typeof VALID)[number],
      {
        reason: typeof body.reason === "string" ? body.reason : undefined,
        days: typeof body.days === "number" ? body.days : undefined,
        expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
      },
      userId,
    );
    return NextResponse.json({ ok: true, entitlement, hasAccess: hasAccess(entitlement.status) }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: "transition_failed", reason: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

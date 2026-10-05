import { NextResponse } from "next/server";
import { requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { activatePaid, hasAccess } from "@/lib/wavesco/entitlements";

export const dynamic = "force-dynamic";

/** POST /api/acquisition/entitlement/activate — record a verified grant.
 *  Owner only. Provider-agnostic seam: the caller supplies the expiry and an
 *  optional external reference. Today Waves confirms payment off-band and the
 *  tenant owner records the grant; the audit row shows exactly who recorded
 *  what and when. Future payment webhooks will call `activatePaid` directly.
 *  Deliberately NOT entitlement-gated: expired tenants renew through here. */
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
      { error: "forbidden", reason: "Owner role required to record paid access.", whatNext: "Ask your workspace owner to complete this step." },
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
  try {
    const { entitlement } = await activatePaid(
      tenantId,
      {
        provider: typeof body.provider === "string" ? body.provider : "manual",
        providerRef: typeof body.providerRef === "string" ? body.providerRef : undefined,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
        days: typeof body.days === "number" ? body.days : undefined,
        expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
        amountPaise: typeof body.amountPaise === "number" ? body.amountPaise : undefined,
        currency: typeof body.currency === "string" ? body.currency : undefined,
        note: typeof body.note === "string" ? body.note : undefined,
      },
      userId,
    );
    return NextResponse.json({ ok: true, entitlement, hasAccess: hasAccess(entitlement.status) }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: "activation_failed", reason: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

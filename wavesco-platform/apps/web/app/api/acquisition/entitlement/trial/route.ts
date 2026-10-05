import { NextResponse } from "next/server";
import { requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { hasAccess, startTrial } from "@/lib/wavesco/entitlements";

export const dynamic = "force-dynamic";

/** POST /api/acquisition/entitlement/trial — self-serve trial start.
 *  Admin+. Idempotent with clear 409s. Provisions the tenant on success.
 *  Deliberately NOT entitlement-gated: this IS the entry point. */
export async function POST() {
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
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", reason: "Admin role required to start a trial.", whatNext: "Ask your workspace owner to start the trial." },
      { status: 403 },
    );
  }
  try {
    const { entitlement } = await startTrial(tenantId, userId);
    return NextResponse.json(
      {
        ok: true,
        entitlement,
        hasAccess: hasAccess(entitlement.status),
        whatNext: "Complete your Company Profile, then activate from the profile page.",
      },
      { status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = (e as { status?: unknown }).status === 409 ? 409 : 400;
    return NextResponse.json({ error: status === 409 ? "already_used" : "trial_failed", reason: msg }, { status });
  }
}

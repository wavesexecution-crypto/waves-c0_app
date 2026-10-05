import { NextResponse } from "next/server";
import { requireControlAuth } from "@/lib/wavesco/control";
import { getAcquisitionOSEntitlement, hasAccess } from "@/lib/wavesco/entitlements";

export const dynamic = "force-dynamic";

/** GET /api/acquisition/entitlement — current access state for this tenant.
 *  Deliberately NOT entitlement-gated: blocked/expired tenants need to read
 *  their own state to understand what happened and what to do next. */
export async function GET() {
  try {
    const { tenantId } = await requireControlAuth();
    const entitlement = await getAcquisitionOSEntitlement(tenantId);
    return NextResponse.json({ entitlement, hasAccess: hasAccess(entitlement.status) }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNAUTHORIZED") || msg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}

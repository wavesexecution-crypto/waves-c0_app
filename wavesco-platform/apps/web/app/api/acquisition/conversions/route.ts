import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import { recordConversion, validateConversion } from "@/lib/wavesco/conversions";

export const dynamic = "force-dynamic";

/** GET /api/acquisition/conversions — verified outcomes for this tenant. */
export async function GET() {
  try {
    const { tenantId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    const rows = await withTenantContext(tenantId, async (tx) =>
      tx.leadConversion.findMany({ where: { tenantId }, orderBy: { updatedAt: "desc" }, take: 500 }),
    );
    return NextResponse.json({ conversions: rows }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

/** POST /api/acquisition/conversions — record a verified outcome (admin+).
 *  MEETING/WON/LOST only. Cancels pending automated follow-ups for the lead. */
export async function POST(req: Request) {
  let tenantId: string;
  let userId: string | null | undefined;
  let role: string;
  try {
    const auth = await requireControlAuth();
    tenantId = auth.tenantId;
    userId = auth.userId;
    role = sessionRole(auth.session);
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden", reason: "Admin role required to record outcomes." }, { status: 403 });
  }
  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const checked = validateConversion(body);
  if (!checked.ok || !checked.value) {
    return NextResponse.json({ error: "invalid conversion", reason: checked.error }, { status: 400 });
  }
  try {
    const result = await recordConversion(tenantId, checked.value, userId);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: "internal", reason: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

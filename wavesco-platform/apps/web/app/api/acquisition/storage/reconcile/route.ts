import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { reconcileStorage } from "@/lib/wavesco/artifacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/acquisition/storage/reconcile — verify every READY object
 *  still has bytes (admin+). Missing bytes are marked MISSING + alerted,
 *  never silently left as READY. Same sweep the scheduler runs. */
export async function POST() {
  try {
    const auth = await requireControlAuth();
    if (sessionRole(auth.session) !== "owner" && sessionRole(auth.session) !== "admin") {
      return NextResponse.json({ error: "forbidden", reason: "Admin role required." }, { status: 403 });
    }
    const denied = await acquisitionDenied(auth.tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    const result = await reconcileStorage(auth.tenantId);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

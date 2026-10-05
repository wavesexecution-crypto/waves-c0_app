import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { archiveBatchReports } from "@/lib/wavesco/artifacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/acquisition/storage/archive — promote a batch's engine-local
 *  report files into durable Waves-held storage (admin+). Idempotent:
 *  already-archived files are skipped. Engine-local files are TRANSIENT;
 *  this step is what makes a report survive restarts and deployments. */
export async function POST(req: Request) {
  let tenantId: string;
  let userId: string | null | undefined;
  try {
    const auth = await requireControlAuth();
    tenantId = auth.tenantId;
    userId = auth.userId;
    if (sessionRole(auth.session) !== "owner" && sessionRole(auth.session) !== "admin") {
      return NextResponse.json({ error: "forbidden", reason: "Admin role required to archive reports." }, { status: 403 });
    }
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const batchId = typeof body.batchId === "string" ? body.batchId.trim().slice(0, 40) : "";
  if (!batchId) return NextResponse.json({ error: "batchId is required" }, { status: 400 });
  const result = await archiveBatchReports(tenantId, batchId, userId);
  return NextResponse.json({ ok: result.failures.length === 0, ...result }, { status: 200 });
}

import { NextResponse } from "next/server";
import { requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";

function clampLimit(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : 50;
  if (Number.isNaN(n) || n <= 0) return 50;
  if (n > 100) return 100;
  return n;
}

export async function GET(req: Request) {
  let tenantId: string;
  try {
    const auth = await requireControlAuth();
    tenantId = auth.tenantId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const digest = (e as any)?.digest as string | undefined;
    const isUnauthorized =
      msg === "UNAUTHORIZED" ||
      msg.includes("UNAUTHORIZED") ||
      msg.includes("NEXT_REDIRECT") ||
      (digest !== undefined && digest.includes("NEXT_REDIRECT"));
    if (isUnauthorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = clampLimit(url.searchParams.get("limit"));

  try {
    const logs = await withTenantContext(tenantId, async (tx: any) => {
      if (!tx.activityEvent || typeof tx.activityEvent.findMany !== "function") return [];
      const rows = await tx.activityEvent.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows as unknown[];
    });

    return NextResponse.json(
      {
        logs,
        events: logs,
        limit,
        count: (logs as unknown[]).length,
        tenantId,
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "internal", detail: msg.slice(0, 300), logs: [], events: [], limit, count: 0 }, { status: 200 });
  }
}

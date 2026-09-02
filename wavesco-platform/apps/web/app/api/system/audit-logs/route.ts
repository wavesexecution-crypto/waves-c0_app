import { NextResponse } from "next/server";
import { requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";

function parseLimit(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : 50;
  if (Number.isNaN(n) || n <= 0) return 50;
  if (n > 100) return 100;
  return n;
}

function parseOffset(raw: string | null, limit: number, pageRaw: string | null): number {
  if (pageRaw) {
    const p = parseInt(pageRaw, 10);
    if (!Number.isNaN(p) && p > 0) return (p - 1) * limit;
  }
  const o = raw ? parseInt(raw, 10) : 0;
  if (Number.isNaN(o) || o < 0) return 0;
  return o;
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
  const limit = parseLimit(url.searchParams.get("limit"));
  const pageParam = url.searchParams.get("page");
  const offset = parseOffset(url.searchParams.get("offset"), limit, pageParam);
  const action = url.searchParams.get("action")?.trim() || null;
  const model = url.searchParams.get("model")?.trim() || null;
  const recordId = url.searchParams.get("recordId")?.trim() || null;

  const where: Record<string, unknown> = { tenantId };
  if (action) where.action = action;
  if (model) where.model = model;
  if (recordId) where.recordId = recordId;

  try {
    const result = await withTenantContext(tenantId, async (tx: any) => {
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }) as Promise<unknown[]>,
        tx.auditLog.count({ where }) as Promise<number>,
      ]);
      return { rows, total };
    });

    const page = pageParam ? parseInt(pageParam, 10) || Math.floor(offset / limit) + 1 : Math.floor(offset / limit) + 1;

    return NextResponse.json(
      {
        auditLogs: result.rows,
        logs: result.rows,
        total: result.total,
        limit,
        offset,
        page,
        filters: { action, model, recordId },
        tenantId,
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: "internal",
        detail: msg.slice(0, 300),
        auditLogs: [],
        logs: [],
        total: 0,
        limit,
        offset,
        page: 1,
        filters: { action, model, recordId },
      },
      { status: 200 }
    );
  }
}

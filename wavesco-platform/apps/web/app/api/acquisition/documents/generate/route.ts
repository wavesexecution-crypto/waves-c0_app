import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auditControl, requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";

export const dynamic = "force-dynamic";

function sanitizeString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export async function POST(req: Request) {
  let tenantId: string;
  let userId: string | null | undefined;
  try {
    const auth = await requireControlAuth();
    tenantId = auth.tenantId;
    userId = auth.userId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const digest = (e as { digest?: string })?.digest as string | undefined;
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

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const batchId = sanitizeString(body.batchId) ?? sanitizeString((body as Record<string, unknown>).id) ?? "";

  // If batchId provided, validate existing batch
  if (batchId) {
    try {
      const result: any = await withTenantContext(tenantId, async (tx: any) => {
        const batch =
          (await tx.generationBatch.findFirst?.({ where: { id: batchId, tenantId } })) ??
          (await tx.generationBatch.findUnique?.({ where: { id: batchId } })) ??
          null;
        if (!batch) return { notFound: true };
        // tenant scoping already enforced via where tenantId or RLS; double-check
        if (batch.tenantId && batch.tenantId !== tenantId) return { notFound: true };
        return { batch };
      });

      if (result.notFound || !result.batch) {
        return NextResponse.json({ error: "batch not found" }, { status: 400 });
      }

      const batch = result.batch as { id: string; requestId: string; status: string; engineBatchId?: string | null; pdfPath?: string | null; excelPath?: string | null };

      await auditControl({
        tenantId,
        userId,
        action: "document.generate",
        model: "GenerationBatch",
        recordId: batch.id,
        before: { status: batch.status },
        after: { status: batch.status },
        metadata: { batchId: batch.id, requestId: batch.requestId, engineBatchId: batch.engineBatchId ?? null },
      });

      return NextResponse.json(
        {
          batchId: batch.id,
          requestId: batch.requestId,
          status: batch.status,
          engineBatchId: (batch as any).engineBatchId ?? null,
          pdfPath: (batch as any).pdfPath ?? null,
          excelPath: (batch as any).excelPath ?? null,
        },
        { status: 200 }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
    }
  }

  // No batchId: expect params to create new batch
  let paramsInput: Record<string, unknown> | null = null;
  if (body.params && typeof body.params === "object" && !Array.isArray(body.params)) {
    paramsInput = body.params as Record<string, unknown>;
  } else {
    // also allow flat params at top level
    const flat: Record<string, unknown> = {};
    if (sanitizeString(body.category)) flat.category = sanitizeString(body.category);
    if (sanitizeString(body.city)) flat.city = sanitizeString(body.city);
    if (sanitizeString(body.tier)) flat.tier = sanitizeString(body.tier);
    if (typeof body.count === "number" || typeof body.count === "string") {
      const n = typeof body.count === "string" ? Number(body.count) : (body.count as number);
      if (!Number.isNaN(n)) flat.count = n;
    }
    if (sanitizeString((body as any).location)) flat.city = sanitizeString((body as any).location);
    if (typeof (body as any).requestedCount === "number") flat.count = (body as any).requestedCount;
    if (Object.keys(flat).length > 0) paramsInput = flat;
  }

  if (!paramsInput || Object.keys(paramsInput).length === 0) {
    return NextResponse.json({ error: "missing batchId or params", hint: "provide batchId or params: { category, city, tier, count }" }, { status: 400 });
  }

  // Validate params
  const category = sanitizeString(paramsInput.category);
  const city = sanitizeString(paramsInput.city) ?? sanitizeString(paramsInput.location);
  const tier = sanitizeString(paramsInput.tier);
  let count: number | undefined;
  if (paramsInput.count !== undefined) {
    const n = typeof paramsInput.count === "string" ? Number(paramsInput.count) : (paramsInput.count as number);
    if (typeof n === "number" && !Number.isNaN(n)) count = Math.trunc(n);
  } else if (paramsInput.requestedCount !== undefined) {
    const n = typeof paramsInput.requestedCount === "string" ? Number(paramsInput.requestedCount) : (paramsInput.requestedCount as number);
    if (typeof n === "number" && !Number.isNaN(n)) count = Math.trunc(n);
  }

  if (count !== undefined && (count < 1 || count > 60)) {
    return NextResponse.json({ error: "count must be between 1 and 60" }, { status: 400 });
  }
  if (tier && !["A", "B", "C", "all"].includes(tier)) {
    return NextResponse.json({ error: "invalid tier" }, { status: 400 });
  }

  const params: Record<string, unknown> = {};
  if (category) params.category = category;
  if (city) params.city = city;
  if (tier && tier !== "all") params.tier = tier;
  if (count !== undefined) params.count = count;
  // keep original params for audit transparency but sanitized
  // also preserve any extra sanitized keys that were valid strings/numbers
  for (const [k, v] of Object.entries(paramsInput)) {
    if (params[k] === undefined && typeof v === "string" && v.trim().length > 0 && v.trim().length < 120) {
      // allow extra string params but sanitize length
      params[k] = v.trim().slice(0, 120);
    }
  }

  if (Object.keys(params).length === 0) {
    return NextResponse.json({ error: "invalid params: provide at least one of category, city, tier, count" }, { status: 400 });
  }

  const requestId = `gen_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

  try {
    const created: any = await withTenantContext(tenantId, async (tx: any) => {
      const data: Record<string, unknown> = {
        tenantId,
        requestId,
        params: params as never,
        status: "queued",
      };
      if (count !== undefined) (data as Record<string, unknown>).requestedCount = count;
      const batch = await tx.generationBatch.create({ data });
      return batch;
    });

    await auditControl({
      tenantId,
      userId,
      action: "document.generate",
      model: "GenerationBatch",
      recordId: created.id,
      after: { status: "queued", params },
      metadata: { requestId, params },
    });

    return NextResponse.json(
      {
        batchId: created.id,
        requestId: created.requestId ?? requestId,
        status: created.status ?? "queued",
        params,
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // attempt to audit failure
    try {
      await auditControl({
        tenantId,
        userId,
        action: "document.generate",
        model: "GenerationBatch",
        metadata: { error: msg, failed: true, params },
      });
    } catch {
      // ignore
    }
    return NextResponse.json({ error: "internal", detail: msg }, { status: 500 });
  }
}

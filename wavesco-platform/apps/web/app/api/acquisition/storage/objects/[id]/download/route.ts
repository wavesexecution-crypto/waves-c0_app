import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import { storageGet, wavesStorageConfig } from "@/lib/wavesco/object-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

async function loadOwned(tenantId: string, id: string) {
  return withTenantContext(tenantId, async (tx) =>
    tx.storedObject.findFirst({ where: { id, tenantId } }),
  );
}

/** GET download — streams bytes only for a READY row owned by this tenant.
 *  Opaque row IDs in URLs; provider keys never leave the server.
 *  DELETED → 410, MISSING → 404 with reason, never a fake success. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { tenantId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    const { id } = await ctx.params;
    const row = await loadOwned(tenantId, id);
    if (!row) return NextResponse.json({ error: "object not found" }, { status: 404 });
    if (row.status === "DELETED") {
      return NextResponse.json({ error: "object deleted", reason: "This file was deleted. Re-upload or regenerate it." }, { status: 410 });
    }
    if (row.status !== "READY") {
      return NextResponse.json(
        { error: "object not downloadable", reason: `Status is ${row.status}. Run storage reconciliation from the Reports page.` },
        { status: row.status === "MISSING" ? 404 : 409 },
      );
    }
    const resolved = wavesStorageConfig();
    if ("error" in resolved) {
      return NextResponse.json({ error: "storage unavailable", reason: resolved.error }, { status: 503 });
    }
    const got = await storageGet(resolved.config, tenantId, row.objectKey);
    if (!got.ok || !got.data) {
      return NextResponse.json(
        { error: "bytes unavailable", reason: got.message ?? "The stored bytes could not be retrieved." },
        { status: got.status === 404 ? 404 : 502 },
      );
    }
    const safeName = row.fileName.replace(/["\r\n]/g, "_");
    return new NextResponse(new Uint8Array(got.data.body), {
      headers: {
        "content-type": row.mime,
        "content-disposition": `attachment; filename="${safeName}"`,
        "x-waves-storage": "waves-held",
        "x-object-status": row.status,
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

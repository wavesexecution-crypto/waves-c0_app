import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import { storageDelete, wavesStorageConfig } from "@/lib/wavesco/object-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

/** GET metadata — this tenant's row only, never bytes or provider keys. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { tenantId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    const { id } = await ctx.params;
    const row = await withTenantContext(tenantId, async (tx) =>
      tx.storedObject.findFirst({
        where: { id, tenantId },
        select: {
          id: true, kind: true, batchId: true, fileName: true, mime: true,
          sizeBytes: true, sha256: true, provider: true, status: true,
          createdByUserId: true, createdAt: true, updatedAt: true, deletedAt: true,
        },
      }),
    );
    if (!row) return NextResponse.json({ error: "object not found" }, { status: 404 });
    return NextResponse.json({ object: row }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

/** DELETE — owner only, idempotent. Removes bytes best-effort, marks the
 *  row DELETED with timestamp (tombstone kept for audit). */
export async function DELETE(_req: Request, ctx: Ctx) {
  let tenantId: string;
  let userId: string | null | undefined;
  try {
    const auth = await requireControlAuth();
    tenantId = auth.tenantId;
    userId = auth.userId;
    if (sessionRole(auth.session) !== "owner") {
      return NextResponse.json({ error: "forbidden", reason: "Owner role required to delete files." }, { status: 403 });
    }
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const row = await withTenantContext(tenantId, async (tx) =>
    tx.storedObject.findFirst({ where: { id, tenantId } }),
  );
  if (!row) return NextResponse.json({ error: "object not found" }, { status: 404 });
  if (row.status === "DELETED") return NextResponse.json({ ok: true, deleted: false, already: true }, { status: 200 });

  const resolved = wavesStorageConfig();
  if ("error" in resolved) {
    return NextResponse.json({ error: "storage unavailable", reason: resolved.error }, { status: 503 });
  }
  const del = await storageDelete(resolved.config, tenantId, row.objectKey);
  if (!del.ok) {
    return NextResponse.json({ error: "delete failed", reason: del.message ?? "Object store refused the delete." }, { status: 502 });
  }
  await withTenantContext(
    tenantId,
    async (tx) => {
      await tx.storedObject.update({ where: { id: row.id }, data: { status: "DELETED", deletedAt: new Date() } });
      await tx.activityEvent.create({
        data: {
          tenantId, type: "storage_delete", title: `File deleted: ${row.fileName.slice(0, 80)}`,
          entityType: "stored_object", entityId: row.id, href: "/acquisition/reports",
          metadata: { objectId: row.id, bytesRemoved: del.data?.deleted ?? false } as never,
        },
      });
    },
    userId ?? undefined,
  );
  return NextResponse.json({ ok: true, deleted: true }, { status: 200 });
}

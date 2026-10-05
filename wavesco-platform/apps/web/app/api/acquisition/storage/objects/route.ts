import { NextResponse } from "next/server";
import { acquisitionDenied, requireControlAuth, sessionRole } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import { storeUpload } from "@/lib/wavesco/artifacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/acquisition/storage/objects — list this tenant's stored-object
 *  metadata (never bytes, never provider keys). */
export async function GET(req: Request) {
  try {
    const { tenantId } = await requireControlAuth();
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    const status = url.searchParams.get("status") ?? "READY";
    const rows = await withTenantContext(tenantId, async (tx) =>
      tx.storedObject.findMany({
        where: {
          tenantId,
          ...(kind ? { kind } : {}),
          ...(status && status !== "all" ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true, kind: true, batchId: true, fileName: true, mime: true,
          sizeBytes: true, sha256: true, provider: true, status: true,
          createdByUserId: true, createdAt: true, updatedAt: true, deletedAt: true,
        },
      }),
    );
    return NextResponse.json({ objects: rows }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

/** POST /api/acquisition/storage/objects — multipart upload (admin+).
 *  Field: `file`. Validated (type/size/magic), stored under a generated
 *  tenant-scoped key, registered as READY, linked to an AcquisitionDataImport
 *  row for the brief. Never trusts client filename/MIME/paths. */
export async function POST(req: Request) {
  let tenantId: string;
  let userId: string | null | undefined;
  try {
    const auth = await requireControlAuth();
    tenantId = auth.tenantId;
    userId = auth.userId;
    if (sessionRole(auth.session) !== "owner" && sessionRole(auth.session) !== "admin") {
      return NextResponse.json({ error: "forbidden", reason: "Admin role required to upload files." }, { status: 403 });
    }
    const denied = await acquisitionDenied(tenantId);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let file: File | null = null;
  let purpose = "import";
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    const p = form.get("purpose");
    if (typeof p === "string" && p.trim()) purpose = p.trim().slice(0, 120);
  } catch {
    return NextResponse.json({ error: "invalid multipart upload", reason: "Send multipart/form-data with a `file` field." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "unreadable upload" }, { status: 400 });
  }

  const stored = await storeUpload(tenantId, userId, { bytes, filename: file.name || "upload" }, purpose);
  if (!stored.ok) {
    return NextResponse.json({ error: "upload_rejected", reason: stored.error }, { status: 400 });
  }
  const upload = file;

  // Link into the brief's import log (metadata row; bytes live in storage).
  try {
    await withTenantContext(
      tenantId,
      async (tx) => {
        let profile = await tx.acquisitionProfile.findFirst({ where: { tenantId } });
        profile ??= await tx.acquisitionProfile.create({ data: { tenantId, status: "DRAFT" } });
        await tx.acquisitionDataImport.create({
          data: {
            tenantId,
            profileId: profile.id,
            fileName: upload.name.slice(0, 200),
            fileType: "upload",
            rowCount: null,
            status: "processed",
            summary: { objectId: stored.objectId, sha256: stored.sha256, sizeBytes: stored.sizeBytes } as never,
          },
        });
      },
      userId ?? undefined,
    );
  } catch (e) {
    // Registry row exists; import-link failure must not orphan silently —
    // surface it so the client knows the file is stored but unlinked.
    return NextResponse.json(
      { ok: true, objectId: stored.objectId, warning: `Stored but import log failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 200 },
    );
  }

  return NextResponse.json(
    { ok: true, objectId: stored.objectId, sizeBytes: stored.sizeBytes, sha256: stored.sha256, mime: stored.mime },
    { status: 200 },
  );
}

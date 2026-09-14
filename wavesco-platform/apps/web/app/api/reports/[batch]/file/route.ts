import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { requireSession } from "@wavesco/auth";
import { auth } from "@/lib/auth";
import { acquisitionDenied } from "@/lib/wavesco/control";
import { fetchManifestFile, getBatchManifest, leadEngineMode } from "@/lib/wavesco/lead-engine";
import { logEngineError } from "@/lib/wavesco/engine-errors";
import { withTenantContext } from "@wavesco/db";
import { archiveBatchReports } from "@/lib/wavesco/artifacts";
import { storageGet, wavesStorageConfig } from "@/lib/wavesco/object-storage";
import {
  buildRuntimeStorageConfig,
  storageGetObject,
  tenantStoragePath,
} from "@/lib/wavesco/storage";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
};

interface RouteContext {
  params: Promise<{ batch: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  const session = await auth();
  let tenantId: string | undefined;
  try {
    const user = requireSession(session) as { tenantId?: string };
    tenantId = user?.tenantId;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Storage-first: when client-controlled storage is connected, the object is
  // authoritative there. On success we stream it with truthful provenance.
  // On any storage failure we fall through with an explicit provenance header.
  async function tryClientStorage(name: string) {
    if (!tenantId) return null;
    try {
      const cfg = await withTenantContext(tenantId, async (tx: any) =>
        buildRuntimeStorageConfig(tx, tenantId),
      );
      if (!cfg) return null;
      const key = tenantStoragePath(tenantId, "reports", name);
      const obj = await storageGetObject(cfg, key);
      if (!obj.ok) return "not_stored";
      return new NextResponse(new Uint8Array(obj.data!.body), {
        headers: {
          "content-type": obj.data!.contentType,
          "content-disposition": `attachment; filename="${name}"`,
          "x-waves-storage": "client-controlled",
          "cache-control": "no-store",
        },
      });
    } catch {
      return "not_stored";
    }
  }

  const { batch } = await ctx.params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "xlsx" ? "xlsx" : "pdf";
  const name = `${batch}.${type}`;

  // Ownership first: the batch must belong to this tenant's GenerationBatch
  // history. Batch IDs are predictable — without this check any authenticated
  // user could fetch any tenant's reports.
  const denied = tenantId ? await acquisitionDenied(tenantId) : null;
  if (denied) return NextResponse.json(denied.body, { status: denied.status });
  const owned = tenantId
    ? await withTenantContext(tenantId, async (tx) =>
        tx.generationBatch.findFirst({ where: { tenantId, engineBatchId: batch }, select: { id: true } }),
      ).catch(() => null)
    : null;
  if (!owned) {
    return NextResponse.json(
      { error: "batch not found", reason: "No report batch with this ID belongs to your workspace." },
      { status: 404 },
    );
  }

  // Durable copy first: a previously archived StoredObject survives engine
  // restarts, deployments and logout. Lazy-archive below keeps this warm.
  if (tenantId) {
    try {
      const archived = await withTenantContext(tenantId, async (tx) =>
        tx.storedObject.findMany({ where: { tenantId, batchId: batch, kind: "report", status: "READY" } }),
      );
      const wanted = archived.find((o) =>
        type === "pdf" ? o.mime === "application/pdf" : o.mime.includes("spreadsheetml") || o.fileName.endsWith(".xlsx"),
      );
      if (wanted) {
        const resolved = wavesStorageConfig();
        if (!("error" in resolved)) {
          const got = await storageGet(resolved.config, tenantId, wanted.objectKey);
          if (got.ok && got.data) {
            return new NextResponse(new Uint8Array(got.data.body), {
              headers: {
                "content-type": wanted.mime,
                "content-disposition": `attachment; filename="${wanted.fileName.replace(/["\r\n]/g, "_")}"`,
                "x-waves-storage": "waves-held",
                "cache-control": "no-store",
              },
            });
          }
        }
      }
    } catch {
      // fall through to legacy sources below
    }
  }

  // Opportunistic durability: serving from a transient source also tries to
  // archive (best-effort, never blocks the download).
  function lazyArchive() {
    if (!tenantId) return;
    void archiveBatchReports(tenantId, batch).catch((e) => {
      console.warn(`[storage] lazy archive failed for batch ${batch}: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  // Client storage probe (applies to both engine ways).
  const stored = await tryClientStorage(name);
  if (stored instanceof NextResponse) return stored;

  // Remote mode: stream the file through the engine's authenticated API.
  if (leadEngineMode() === "remote") {
    const file = await fetchManifestFile(batch, type);
    if (!file.ok) {
      logEngineError("reports:file", file.error);
      return NextResponse.json({ error: "That file isn't available right now." }, { status: 404 });
    }
    lazyArchive();
    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${file.filename}"`,
        "x-waves-storage": "waves-managed",
        "cache-control": "no-store",
      },
    });
  }

  // Local mode: read the file directly from the engine host.
  const manifest = await getBatchManifest(batch);
  if (!manifest) {
    return NextResponse.json({ error: `No batch manifest for ${batch}` }, { status: 404 });
  }
  const path = type === "pdf" ? manifest.pdfPath : manifest.excelPath;
  if (!path || !existsSync(path)) {
    return NextResponse.json({ error: `${type.toUpperCase()} file not present on disk` }, { status: 404 });
  }

  const data = readFileSync(path);
  const filename = basename(path) ?? `${batch}.${type}`;
  lazyArchive();
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-waves-storage": stored === "not_stored" ? "not-in-client-storage" : "waves-managed",
      "cache-control": "no-store",
    },
  });
}

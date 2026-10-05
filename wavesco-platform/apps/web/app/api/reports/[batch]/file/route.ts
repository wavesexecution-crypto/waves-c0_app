import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { requireSession } from "@wavesco/auth";
import { auth } from "@/lib/auth";
import { fetchManifestFile, getBatchManifest, leadEngineMode } from "@/lib/wavesco/lead-engine";
import { withTenantContext } from "@wavesco/db";
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
  let sessionTenantId: string | undefined;
  try {
    const user = requireSession(session) as { tenantId?: string };
    sessionTenantId = user?.tenantId;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sessionTenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId: string = sessionTenantId;

  const { batch } = await ctx.params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "xlsx" ? "xlsx" : "pdf";
  const name = `${batch}.${type}`;

  // TENANT GATE. The engine's manifest list is global, so resolving `batch`
  // from the URL alone let any authenticated client download another
  // workspace's report. A batch is ours only when it is linked to this tenant
  // through a GenerationBatch row or an archived StoredObject.
  let owned = false;
  let archived: { objectKey: string; fileName: string; mime: string }[] = [];
  try {
    const data = await withTenantContext(tenantId, async (tx: any) => {
      const linked = await tx.generationBatch.findFirst({
        where: { tenantId, engineBatchId: batch },
        select: { id: true },
      });
      const objects = await tx.storedObject.findMany({
        where: { tenantId, batchId: batch, kind: "report", status: "READY" },
        select: { objectKey: true, fileName: true, mime: true },
      });
      return { linked: Boolean(linked), objects };
    });
    owned = data.linked || data.objects.length > 0;
    archived = data.objects;
  } catch (e) {
    console.error("[reports:file] ownership check failed", e);
    return NextResponse.json({ error: "We could not verify access to that report. Try again." }, { status: 503 });
  }

  if (!owned) {
    // Not linked to this workspace — never touch the engine or the disk.
    return NextResponse.json({ error: "That report isn't available." }, { status: 404 });
  }

  // Durable archived copy first: it survives engine restarts and is the only
  // source that works when the engine host has been recycled.
  if (archived.length > 0) {
    try {
      const { wavesStorageConfig, storageGet } = await import("@/lib/wavesco/object-storage");
      const resolved = wavesStorageConfig();
      if (!("error" in resolved)) {
        const wanted = archived.find((o) => o.fileName.toLowerCase().endsWith(`.${type}`)) ?? archived[0]!;
        const got = await storageGet(resolved.config, tenantId, wanted.objectKey);
        if (got.ok && got.data) {
          return new NextResponse(new Uint8Array(got.data.body), {
            headers: {
              "content-type": got.data.contentType ?? wanted.mime ?? MIME[`.${type}`],
              "content-disposition": `attachment; filename="${wanted.fileName}"`,
              "x-waves-storage": "waves-held",
              "cache-control": "no-store",
            },
          });
        }
      }
    } catch (e) {
      console.error("[reports:file] archived read failed", e);
    }
  }

  // Client-controlled storage probe (applies to both engine ways).
  async function tryClientStorage() {
    try {
      const cfg = await withTenantContext(tenantId, async (tx: any) =>
        buildRuntimeStorageConfig(tx, tenantId),
      );
      if (!cfg) return null;
      const key = tenantStoragePath(tenantId, "reports", name);
      const obj = await storageGetObject(cfg, key);
      if (!obj.ok) return null;
      return new NextResponse(new Uint8Array(obj.data!.body), {
        headers: {
          "content-type": obj.data!.contentType,
          "content-disposition": `attachment; filename="${name}"`,
          "x-waves-storage": "client-controlled",
          "cache-control": "no-store",
        },
      });
    } catch {
      return null;
    }
  }

  const stored = await tryClientStorage();
  if (stored) return stored;

  // Remote mode: stream the file through the engine's authenticated API.
  if (leadEngineMode() === "remote") {
    const file = await fetchManifestFile(batch, type);
    if (!file.ok) {
      console.error(`[reports:file] engine fetch failed: ${file.error}`);
      return NextResponse.json({ error: "That file isn't available right now." }, { status: 404 });
    }
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
    return NextResponse.json({ error: "That report isn't available." }, { status: 404 });
  }
  const path = type === "pdf" ? manifest.pdfPath : manifest.excelPath;
  if (!path || !existsSync(path)) {
    return NextResponse.json({ error: `${type.toUpperCase()} file not present on disk` }, { status: 404 });
  }

  const data = readFileSync(path);
  const filename = basename(path) ?? name;
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-waves-storage": "waves-managed",
      "cache-control": "no-store",
    },
  });
}
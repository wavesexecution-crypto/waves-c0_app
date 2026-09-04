/**
 * GET    /api/acquisition/storage/files — list tenant-scoped objects.
 * DELETE /api/acquisition/storage/files — delete one tenant-scoped object.
 *
 * Every key is validated with isTenantPath(tenantId, key) so no operation can
 * read or delete another tenant's objects. Truthful provider results only.
 */

import { NextResponse } from "next/server";
import { requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import {
  buildRuntimeStorageConfig,
  storageListKeys,
  storageDeleteObject,
  isTenantPath,
  tenantStoragePath,
} from "@/lib/wavesco/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const digest = (e as any)?.digest as string | undefined;
  return (
    msg === "UNAUTHORIZED" ||
    msg.includes("UNAUTHORIZED") ||
    msg.includes("NEXT_REDIRECT") ||
    (digest ? digest.includes("NEXT_REDIRECT") : false)
  );
}

export async function GET(request: Request) {
  try {
    const { tenantId } = await requireControlAuth();
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const prefix = kind ? tenantStoragePath(tenantId, kind, "") : `tenants/${tenantId}/`;

    const result = await withTenantContext(tenantId, async (tx: any) => {
      const cfg = await buildRuntimeStorageConfig(tx, tenantId);
      if (!cfg) return { error: "No storage connection configured.", status: 409 };
      const listing = await storageListKeys(cfg, prefix);
      if (!listing.ok) {
        return { error: `Storage unavailable: ${listing.message ?? listing.fault ?? "provider error"}`, status: 502 };
      }
      const keys = (listing.data?.keys ?? []).filter((k) => isTenantPath(tenantId, k));
      return { keys };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ keys: result.keys, prefix }, { status: 200 });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "internal", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { tenantId } = await requireControlAuth();
    const body = (await request.json().catch(() => ({}))) as { key?: string };

    if (typeof body.key !== "string" || !body.key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }
    const key = body.key; // captured const so narrowing survives closures
    // Cross-tenant / traversal guard — key must be inside this tenant's prefix.
    if (!isTenantPath(tenantId, key)) {
      return NextResponse.json({ error: "Invalid storage key." }, { status: 400 });
    }

    const result = await withTenantContext(tenantId, async (tx: any) => {
      const cfg = await buildRuntimeStorageConfig(tx, tenantId);
      if (!cfg) return { error: "No storage connection configured.", status: 409 };
      const del = await storageDeleteObject(cfg, key);
      if (!del.ok) {
        return { error: `Delete failed: ${del.message ?? del.fault ?? "provider error"}`, status: 502 };
      }
      await tx.activityEvent.create({
        data: {
          tenantId,
          type: "storage.object_deleted",
          title: `Stored object deleted: ${key}`,
          entityType: "acquisition_profile",
          entityId: null,
          href: "/acquisition/integrations",
        },
      });
      return { key };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, key: result.key }, { status: 200 });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "internal", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
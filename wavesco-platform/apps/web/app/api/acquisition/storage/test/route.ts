/**
 * POST /api/acquisition/storage/test — test a storage connection.
 *
 * Two modes:
 * - Candidate credentials in the body (not persisted): bucket, region,
 *   endpoint, accessKeyId, secretAccessKey.
 * - { persisted: true } to re-test the currently saved connection.
 *
 * Never persists on test. Returns the real provider result — a failed test is
 * reported as failed, never a fake connected state.
 */

import { NextResponse } from "next/server";
import { requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import {
  normalizeBucket,
  normalizeRegion,
  normalizeEndpoint,
  isValidBucket,
  testStorageConnection,
  buildRuntimeStorageConfig,
  type StorageConfig,
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

export async function POST(req: Request) {
  try {
    const { tenantId } = await requireControlAuth();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    let cfg: StorageConfig | null = null;
    let mode: "candidate" | "persisted" = "candidate";

    if (body?.persisted === true) {
      mode = "persisted";
      cfg = await withTenantContext(tenantId, async (tx: any) => buildRuntimeStorageConfig(tx, tenantId));
      if (!cfg) {
        return NextResponse.json(
          { error: "No storage connection configured." },
          { status: 409 },
        );
      }
    } else {
      const bucket = normalizeBucket(String(body.bucket ?? ""));
      const region = normalizeRegion(String(body.region ?? "us-east-1"));
      const endpoint = normalizeEndpoint(body.endpoint ? String(body.endpoint) : null);
      const accessKeyId = typeof body.accessKeyId === "string" ? body.accessKeyId.trim() : "";
      const secretAccessKey = typeof body.secretAccessKey === "string" ? body.secretAccessKey.trim() : "";

      if (!isValidBucket(bucket) || !accessKeyId || !secretAccessKey) {
        return NextResponse.json({ error: "Bucket, access key and secret are required." }, { status: 400 });
      }
      cfg = { provider: "s3", bucket, region, endpoint, accessKeyId, secretAccessKey };
    }

    const test = await testStorageConnection(cfg);
    if (test.ok) {
      return NextResponse.json({ ok: true, latencyMs: test.data?.latencyMs ?? null }, { status: 200 });
    }
    return NextResponse.json(
      {
        ok: false,
        fault: test.fault ?? "unavailable",
        message: test.message ?? "Connection failed",
        latencyMs: test.data?.latencyMs ?? null,
        mode,
      },
      { status: 200 },
    );
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "internal", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
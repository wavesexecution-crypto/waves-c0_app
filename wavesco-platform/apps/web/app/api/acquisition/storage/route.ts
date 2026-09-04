/**
 * GET  /api/acquisition/storage — client-controlled storage connection status.
 * POST /api/acquisition/storage — connect (encrypt + persist credentials, audit).
 * DELETE /api/acquisition/storage — disconnect (remove persisted config).
 *
 * Credentials are AES-256-GCM encrypted with a server-side key before
 * persistence; the raw profile is sanitized before any browser read, so keys
 * never reach the client. Test Connection keeps a truthful status (connected /
 * unavailable / not tested) — never a fake connected state.
 */

import { NextResponse } from "next/server";
import { requireControlAuth } from "@/lib/wavesco/control";
import { withTenantContext } from "@wavesco/db";
import {
  encryptStorageCredentials,
  normalizeBucket,
  normalizeRegion,
  normalizeEndpoint,
  isValidBucket,
  readPersistedStorageConfig,
  writePersistedStorageConfig,
  sanitizeStorageConfigForClient,
  testStorageConnection,
  buildRuntimeStorageConfig,
  type OpaqueStorageConfig,
} from "@/lib/wavesco/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AUTH_MSG = "UNAUTHORIZED";
function isUnauthorized(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const digest = (e as any)?.digest as string | undefined;
  return (
    msg === AUTH_MSG ||
    msg.includes(AUTH_MSG) ||
    msg.includes("NEXT_REDIRECT") ||
    (digest ? digest.includes("NEXT_REDIRECT") : false)
  );
}

export async function GET() {
  try {
    const { tenantId } = await requireControlAuth();
    const status = await withTenantContext(tenantId, async (tx: any) => {
      const persisted = await readPersistedStorageConfig(tx, tenantId);
      return sanitizeStorageConfigForClient(persisted);
    });
    return NextResponse.json({ configured: status !== null, storage: status });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "internal", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { tenantId } = await requireControlAuth();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const bucket = normalizeBucket(String(body.bucket ?? ""));
    const region = normalizeRegion(String(body.region ?? "us-east-1"));
    const endpoint = normalizeEndpoint(body.endpoint ? String(body.endpoint) : null);
    const accessKeyId = typeof body.accessKeyId === "string" ? body.accessKeyId.trim() : "";
    const secretAccessKey = typeof body.secretAccessKey === "string" ? body.secretAccessKey.trim() : "";

    if (!isValidBucket(bucket)) {
      return NextResponse.json({ error: "Invalid S3 bucket name." }, { status: 400 });
    }

    // Re-test only (no credential change) when body carries no creds.
    if (!accessKeyId && !secretAccessKey) {
      const result = await withTenantContext(tenantId, async (tx: any) => {
        const persisted = await readPersistedStorageConfig(tx, tenantId);
        if (!persisted) return { error: "No storage connection configured.", status: 409 };
        const cfg = await buildRuntimeStorageConfig(tx, tenantId);
        if (!cfg) return { error: "Storage credentials could not be decrypted (server key missing).", status: 503 };
        const test = await testStorageConnection(cfg);
        await writePersistedStorageConfig(tx, tenantId, {
          ...persisted,
          lastTestedAt: new Date().toISOString(),
          lastTestOk: test.ok,
        } as OpaqueStorageConfig);
        return { test };
      });
      if ("error" in result) {
        const code = result.status === 409 ? 409 : 503;
        return NextResponse.json({ error: result.error }, { status: code });
      }
      return NextResponse.json({ configured: true, test: result.test }, { status: 200 });
    }

    if (!accessKeyId || !secretAccessKey) {
      return NextResponse.json({ error: "Both access key and secret are required." }, { status: 400 });
    }

    const enc = encryptStorageCredentials(accessKeyId, secretAccessKey);
    if ("error" in enc) {
      if (enc.error === "no_key") {
        return NextResponse.json(
          { error: "Storage is not ready yet: the server-side encryption key (STORAGE_ENCRYPTION_KEY) is not configured." },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "Invalid credentials provided." }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const opaque: OpaqueStorageConfig = {
      provider: "s3",
      bucket,
      region,
      endpoint,
      cred: enc.cred,
      createdAt: nowIso,
      connectedAt: nowIso,
      lastTestedAt: nowIso,
      lastTestOk: null,
    };

    const result = await withTenantContext(tenantId, async (tx: any) => {
      const saved = await writePersistedStorageConfig(tx, tenantId, opaque);
      if (!saved) return { error: "Acquisition profile not found — complete onboarding first.", status: 409 };
      const cfg = await buildRuntimeStorageConfig(tx, tenantId);
      const test = cfg ? await testStorageConnection(cfg) : null;
      if (test) {
        opaque.lastTestedAt = new Date().toISOString();
        opaque.lastTestOk = test.ok;
        if (test.ok) opaque.connectedAt = opaque.lastTestedAt;
        await writePersistedStorageConfig(tx, tenantId, opaque);
      }
      await tx.activityEvent.create({
        data: {
          tenantId,
          type: "storage.connected",
          title: `Client-controlled storage connected (${bucket})`,
          entityType: "acquisition_profile",
          entityId: null,
          href: "/acquisition/integrations",
        },
      });
      return { saved: true, test };
    });

    if ("error" in result) {
      const code = result.status === 409 ? 409 : 500;
      return NextResponse.json({ error: result.error }, { status: code });
    }
    return NextResponse.json(
      { configured: true, storage: sanitizeStorageConfigForClient(opaque), test: result.test },
      { status: 200 },
    );
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "internal", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const { tenantId } = await requireControlAuth();
    await withTenantContext(tenantId, async (tx: any) => {
      await writePersistedStorageConfig(tx, tenantId, null);
      await tx.activityEvent.create({
        data: {
          tenantId,
          type: "storage.disconnected",
          title: "Client-controlled storage disconnected",
          entityType: "acquisition_profile",
          entityId: null,
          href: "/acquisition/integrations",
        },
      });
    });
    return NextResponse.json({ configured: false }, { status: 200 });
  } catch (e) {
    if (isUnauthorized(e)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "internal", detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
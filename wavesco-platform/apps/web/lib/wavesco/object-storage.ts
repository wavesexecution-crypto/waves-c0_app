import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  buildObjectUrl,
  isTenantPath,
  sanitizeSegment,
  storageDeleteObject,
  storageGetObject,
  storagePutObject,
  tenantStoragePath,
  testStorageConnection,
  type StorageConfig,
  type StorageResult,
} from "./storage";

/**
 * Waves-held object storage — the durable home for client artifacts.
 *
 * Two providers behind one interface:
 *   local — filesystem directory for development and tests. NEVER used in
 *           production unless explicitly allowed (see wavesStorageConfig).
 *   s3    — S3-compatible bucket via the dependency-free SigV4 client in
 *           ./storage. Required in production.
 *
 * Keys are ALWAYS tenant-scoped (`tenants/<tenantId>/<kind>/...`) and
 * generated server-side. Callers never accept a client-supplied key, and
 * `isTenantPath` guards every operation. Bytes are only ever served through
 * an authenticated route after a tenant-scoped StoredObject lookup — opaque
 * row IDs in URLs, never raw keys or tenant IDs.
 */

export type WavesStorageProvider = "local" | "s3";

export interface ObjectBytes {
  body: Buffer;
  contentType: string;
  size: number;
}

export interface StoragePing {
  ok: boolean;
  provider: WavesStorageProvider;
  detail: string;
  latencyMs: number;
}

export interface ResolvedLocal {
  provider: "local";
  localRoot: string;
}

export interface ResolvedS3 {
  provider: "s3";
  s3: StorageConfig;
}

/** Discriminated by provider so narrowing (not assertions) proves which
 *  config is present in each branch. */
export type ResolvedStorage = ResolvedLocal | ResolvedS3;

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/** Resolve which provider serves Waves-held artifacts. Never silently local
 *  in production: Vercel/production without S3 configured is an explicit
 *  error (BLOCKED), not a quiet fallback to an ephemeral filesystem. */
export function wavesStorageConfig(): { config: ResolvedStorage } | { error: string } {
  const want = env("STORAGE_PROVIDER").toLowerCase() || "local";
  if (want === "s3") {
    const bucket = env("STORAGE_S3_BUCKET");
    const region = env("STORAGE_S3_REGION") || "us-east-1";
    const endpoint = env("STORAGE_S3_ENDPOINT") || null;
    const accessKeyId = env("STORAGE_S3_ACCESS_KEY_ID");
    const secretAccessKey = env("STORAGE_S3_SECRET_ACCESS_KEY");
    if (!bucket) return { error: "STORAGE_S3_BUCKET is not configured." };
    if (!accessKeyId || !secretAccessKey) {
      return { error: "STORAGE_S3_ACCESS_KEY_ID / STORAGE_S3_SECRET_ACCESS_KEY are not configured." };
    }
    return {
      config: {
        provider: "s3",
        s3: { provider: "s3", bucket, region, endpoint, accessKeyId, secretAccessKey },
      },
    };
  }
  if (want !== "local") return { error: `Unknown STORAGE_PROVIDER "${want}" (expected local|s3).` };
  const prod = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  if (prod && env("STORAGE_ALLOW_LOCAL") !== "true") {
    return {
      error:
        "No persistent storage configured: STORAGE_PROVIDER=local is refused in production (ephemeral filesystem). Configure S3 (STORAGE_PROVIDER=s3 + STORAGE_S3_*) or explicitly set STORAGE_ALLOW_LOCAL=true.",
    };
  }
  const root = env("STORAGE_LOCAL_ROOT") || join(process.cwd(), ".storage-local");
  return { config: { provider: "local", localRoot: root } };
}

/** Generated, tenant-scoped object key. Filename is sanitized; uniqueness
 *  comes from the caller-supplied id (object row id or uuid). */
export function wavesObjectKey(tenantId: string, kind: string, id: string, filename: string): string {
  const safe = sanitizeSegment(filename, "file").slice(0, 120) || "file";
  return tenantStoragePath(tenantId, kind, `${sanitizeSegment(id, "obj")}-${safe}`);
}

function localPath(root: string, key: string): string {
  // Defense in depth: even though keys are server-generated, resolve +
  // containment-check before touching disk. Never trust a key as a path.
  const abs = resolve(root, key);
  const base = resolve(root) + sep;
  if (abs !== resolve(root) && !abs.startsWith(base)) throw new Error("object key escapes storage root");
  return abs;
}

function requireTenantKey(tenantId: string, key: string): void {
  if (!isTenantPath(tenantId, key)) throw new Error("object key is outside the tenant scope");
}

export async function storagePut(
  cfg: ResolvedStorage,
  tenantId: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<StorageResult<{ size: number }>> {
  requireTenantKey(tenantId, key);
  if (cfg.provider === "local") {
    try {
      const p = localPath(cfg.localRoot, key);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
      return { ok: true, status: 200, data: { size: body.length } };
    } catch (e) {
      return { ok: false, fault: "unavailable", message: e instanceof Error ? e.message : String(e) };
    }
  }
  return storagePutObject(cfg.s3, key, body, contentType).then((r) =>
    r.ok ? { ok: true, status: r.status, data: { size: body.length } } : { ok: false, fault: r.fault, status: r.status, message: r.message },
  );
}

export async function storageGet(
  cfg: ResolvedStorage,
  tenantId: string,
  key: string,
): Promise<StorageResult<ObjectBytes>> {
  requireTenantKey(tenantId, key);
  if (cfg.provider === "local") {
    try {
      const p = localPath(cfg.localRoot, key);
      if (!existsSync(p)) return { ok: false, fault: "not_found", status: 404, message: "Object not found in local storage." };
      const body = readFileSync(p);
      return { ok: true, status: 200, data: { body, contentType: "application/octet-stream", size: body.length } };
    } catch (e) {
      return { ok: false, fault: "unavailable", message: e instanceof Error ? e.message : String(e) };
    }
  }
  const r = await storageGetObject(cfg.s3, key);
  if (!r.ok || !r.data) return { ok: false, fault: r.fault, status: r.status, message: r.message };
  return { ok: true, status: r.status, data: { body: r.data.body, contentType: r.data.contentType, size: r.data.body.length } };
}

export async function storageDelete(
  cfg: ResolvedStorage,
  tenantId: string,
  key: string,
): Promise<StorageResult<{ deleted: boolean }>> {
  requireTenantKey(tenantId, key);
  if (cfg.provider === "local") {
    try {
      const p = localPath(cfg.localRoot, key);
      if (!existsSync(p)) return { ok: true, status: 200, data: { deleted: false } };
      unlinkSync(p);
      return { ok: true, status: 200, data: { deleted: true } };
    } catch (e) {
      return { ok: false, fault: "unavailable", message: e instanceof Error ? e.message : String(e) };
    }
  }
  const r = await storageDeleteObject(cfg.s3, key);
  // S3 DELETE is idempotent: 200/204 means gone (whether or not it existed).
  if (!r.ok) return { ok: false, fault: r.fault, status: r.status, message: r.message };
  return { ok: true, status: r.status, data: { deleted: true } };
}

export async function storageExists(
  cfg: ResolvedStorage,
  tenantId: string,
  key: string,
): Promise<boolean> {
  requireTenantKey(tenantId, key);
  if (cfg.provider === "local") {
    try {
      return existsSync(localPath(cfg.localRoot, key));
    } catch {
      return false;
    }
  }
  // HEAD via the generic SigV4 signer (no extra dependency).
  const { signRequest } = await import("./storage");
  try {
    const signed = signRequest(cfg.s3, { method: "HEAD", path: key });
    const res = await fetch(signed.url.toString(), {
      method: "HEAD",
      headers: signed.headers,
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Real capability probe: local → write/read/delete round-trip in a scratch
 *  key; s3 → ListObjectsV2 handshake. Never reports ok without proof. */
export async function storagePing(cfg: ResolvedStorage): Promise<StoragePing> {
  const t0 = Date.now();
  if (cfg.provider === "local") {
    try {
      const root = resolve(cfg.localRoot);
      mkdirSync(root, { recursive: true });
      const probe = join(root, `.ping-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
      writeFileSync(probe, "ping");
      const back = readFileSync(probe, "utf8");
      unlinkSync(probe);
      if (back !== "ping") throw new Error("read-back mismatch");
      return { ok: true, provider: "local", detail: `writable directory ${root}`, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, provider: "local", detail: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - t0 };
    }
  }
  const t = await testStorageConnection(cfg.s3);
  return {
    ok: t.ok,
    provider: "s3",
    detail: t.ok ? `bucket reachable (${t.data?.latencyMs ?? 0}ms)` : (t.message ?? t.fault ?? "unreachable"),
    latencyMs: Date.now() - t0,
  };
}

/** Public base URL for display only (never a direct object URL). */
export function storageDescribe(cfg: ResolvedStorage): { provider: WavesStorageProvider; location: string } {
  if (cfg.provider === "local") return { provider: "local", location: cfg.localRoot };
  const u = buildObjectUrl(cfg.s3, "");
  return { provider: "s3", location: `${u.host}/${cfg.s3.bucket}` };
}

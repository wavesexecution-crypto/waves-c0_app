/**
 * Client-controlled storage adapter — S3-compatible object storage.
 *
 * Dependency-free (AWS Signature V4 via node:crypto + fetch). Follows the
 * existing `credentialRef` convention: provider keys never reach the browser.
 *
 * Persistence model (no schema change): the per-tenant storage configuration
 * lives in the AcquisitionProfile `integrations.storage` JSON section. The
 * access key + secret are AES-256-GCM encrypted with a server-side key from
 * env `STORAGE_ENCRYPTION_KEY` before persistence. The profile read path must
 * strip the `cred` blob before serving (see sanitizeStorageConfigForClient).
 *
 * Truthfulness: every operation returns the real provider result. If the
 * provider cannot be reached the connection reports `unavailable` — never a
 * fake connected state, never a silent fallback to Waves-held persistence.
 *
 * Missing external dependency (the ONLY one for storage): a real S3-compatible
 * bucket plus server env STORAGE_ENCRYPTION_KEY.
 */

import crypto from "node:crypto";

// ─── Config ─────────────────────────────────────────────────────────────

export type StorageProvider = "s3";

export interface StorageConfig {
  provider: StorageProvider;
  bucket: string;
  region: string;
  endpoint: string | null; // custom S3-compatible endpoint (MinIO/R2/etc.)
  accessKeyId: string;
  secretAccessKey: string;
}

/** What is persisted in the profile JSON (credentials encrypted, never plaintext). */
export interface OpaqueStorageConfig {
  provider: StorageProvider;
  bucket: string;
  region: string;
  endpoint: string | null;
  cred: string; // v1.<iv>.<authTag>.<ciphertext> — server-side only
  createdAt?: string;
  connectedAt?: string | null;
  lastTestedAt?: string | null;
  lastTestOk?: boolean | null;
}

export function getStorageEncryptionKey(): string {
  return process.env.STORAGE_ENCRYPTION_KEY?.trim() ?? "";
}

export function normalizeBucket(bucket: string): string {
  return bucket.trim().toLowerCase();
}

export function normalizeRegion(region: string): string {
  return region.trim().toLowerCase() || "us-east-1";
}

export function normalizeEndpoint(endpoint: string | null | undefined): string | null {
  if (!endpoint || !endpoint.trim()) return null;
  const e = endpoint.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(e)) return null;
  return e;
}

export function isValidBucket(bucket: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(normalizeBucket(bucket));
}

// ─── Credential encryption (server-side only) ───────────────────────────

export function encryptStorageCredentials(
  accessKeyId: string,
  secretAccessKey: string,
): { cred: string } | { error: "no_key" | "invalid" } {
  if (!accessKeyId || !secretAccessKey) return { error: "invalid" };
  const key = getStorageEncryptionKey();
  if (!key) return { error: "no_key" };
  const sk = crypto.createHash("sha256").update(key).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sk, iv);
  const payload = JSON.stringify({ a: accessKeyId, s: secretAccessKey });
  const enc = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    cred: `v1.${iv.toString("base64url")}.${authTag.toString("base64url")}.${enc.toString("base64url")}`,
  };
}

export function decryptStorageCredentials(
  cred: string,
): { accessKeyId: string; secretAccessKey: string } | null {
  const key = getStorageEncryptionKey();
  if (!key) return null;
  const parts = cred.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const sk = crypto.createHash("sha256").update(key).digest();
    const iv = Buffer.from(parts[1] ?? "", "base64url");
    const authTag = Buffer.from(parts[2] ?? "", "base64url");
    const data = Buffer.from(parts[3] ?? "", "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", sk, iv);
    decipher.setAuthTag(authTag);
    const pt = Buffer.concat([decipher.update(data), decipher.final()]);
    const j = JSON.parse(pt.toString("utf8")) as { a?: unknown; s?: unknown };
    if (typeof j.a !== "string" || typeof j.s !== "string") return null;
    return { accessKeyId: j.a, secretAccessKey: j.s };
  } catch {
    return null;
  }
}

/** Strip everything secret before returning to the browser. */
export function sanitizeStorageConfigForClient(
  cfg: OpaqueStorageConfig | null,
): Record<string, unknown> | null {
  if (!cfg) return null;
  const { cred: _cred, ...rest } = cfg;
  return { ...rest, configured: true, secretConfigured: true };
}

// ─── Tenant-scoped object paths ─────────────────────────────────────────

const SAFE_NAME = /[^a-zA-Z0-9._-]/g;

export function sanitizeSegment(seg: string, fallback: string): string {
  // Collapse dot-runs first: keys must never contain "..", which the
  // isTenantPath guard (correctly) rejects. Without this, generated keys
  // for dotty filenames would fail their own guard.
  const s = seg
    .replace(/\.{2,}/g, "_")
    .replace(SAFE_NAME, "_")
    .replace(/^_+|_+$/g, "");
  return s || fallback;
}

/** Build a tenant-scoped object key: tenants/<tenantId>/<kind>/<name>. */
export function tenantStoragePath(tenantId: string, kind: string, filename: string): string {
  return `tenants/${sanitizeSegment(tenantId, "tenant")}/${sanitizeSegment(kind, "misc")}/${sanitizeSegment(filename, "file")}`;
}

/** Guard against path traversal / cross-tenant prefixes. Keys must remain under the tenant. */
export function isTenantPath(tenantId: string, path: string): boolean {
  if (!path) return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/")) return false;
  if (/(^|%)2f/i.test(path)) return false; // encoded slash
  return path.startsWith(`tenants/${sanitizeSegment(tenantId, "tenant")}/`);
}

// ─── AWS Signature V4 (S3) — dependency-free ───────────────────────────

function sha256hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function isoBasic(d: Date): string {
  return d.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");
}

function uriEncode(path: string): string {
  // S3 requires certain chars unescaped; encodeURIComponent covers the rest.
  return encodeURIComponent(path).replace(/%2F/g, "/").replace(/%2C/g, ",");
}

interface SigningOptions {
  method: string;
  path: string; // object key (within bucket)
  query?: Record<string, string>;
  body?: Buffer | string;
  now?: Date;
  contentType?: string;
}

export interface SignedRequest {
  url: URL;
  headers: Record<string, string>;
  canonicalQuery: string;
}

function hostHeaderFor(cfg: StorageConfig): string {
  const endpoint = normalizeEndpoint(cfg.endpoint) ?? "https://s3.amazonaws.com";
  const u = new URL(endpoint);
  return u.port ? `${u.hostname}:${u.port}` : u.hostname;
}

export function buildObjectUrl(cfg: StorageConfig, path: string): URL {
  const endpoint = normalizeEndpoint(cfg.endpoint) ?? "https://s3.amazonaws.com";
  const u = new URL(endpoint);
  u.pathname = `${u.pathname.replace(/\/+$/, "")}/${encodeURIComponent(cfg.bucket)}/${uriEncode(path)}`;
  return u;
}

/** Path-style canonical URI used in the SigV4 canonical request. */
export function canonicalUriFor(cfg: StorageConfig, path: string): string {
  return `/${encodeURIComponent(cfg.bucket)}/${uriEncode(path)}`;
}

/** Sign a request with SigV4 (x-amz-content-sha256 for S3 integrity). */
export function signRequest(cfg: StorageConfig, opts: SigningOptions): SignedRequest {
  const now = opts.now ?? new Date();
  const amzDate = isoBasic(now);
  const dateScope = amzDate.slice(0, 8);
  const payload = opts.body !== undefined ? opts.body : "";
  const hashedPayload = sha256hex(payload);
  const host = hostHeaderFor(cfg);
  const contentType = opts.contentType;

  const query: Record<string, string> = { ...(opts.query ?? {}) };
  const signedQuery = Object.fromEntries(
    Object.entries(query)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)]),
  );
  const canonicalQuery = Object.entries(signedQuery)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalHeadersList: Array<[string, string]> = [
    ["host", host],
    ["x-amz-content-sha256", hashedPayload],
    ["x-amz-date", amzDate],
  ];
  if (contentType) canonicalHeadersList.push(["content-type", contentType]);
  canonicalHeadersList.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = canonicalHeadersList.map(([k]) => k).join(";");
  const canonicalHeaders = canonicalHeadersList.map(([k, v]) => `${k}:${v}\n`).join("");

  const canonicalUri = canonicalUriFor(cfg, opts.path);
  const canonicalRequest = `${opts.method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;

  const scope = `${dateScope}/${cfg.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonicalRequest)}`;

  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateScope);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const credential = `${cfg.accessKeyId}/${scope}`;
  const signedHeadersForAuth = signedHeaders;
  const authorization = `AWS4-HMAC-SHA256 Credential=${credential}, SignedHeaders=${signedHeadersForAuth}, Signature=${signature}`;

  const url = buildObjectUrl(cfg, opts.path);
  url.search = canonicalQuery;

  const headers: Record<string, string> = {};
  for (const [k, v] of canonicalHeadersList) headers[k] = v;
  headers["authorization"] = authorization;

  return { url, headers, canonicalQuery };
}

// ─── Fault classification ───────────────────────────────────────────────

export type StorageFault =
  | "invalid_credentials"
  | "permission_denied"
  | "not_found"
  | "unavailable"
  | "timeout"
  | "invalid_config";

export interface StorageResult<T> {
  ok: boolean;
  fault?: StorageFault;
  status?: number;
  message?: string;
  data?: T;
}

function classifyStatus(status: number, body = ""): StorageFault {
  if (status === 404) return "not_found";
  if (status === 401) return "invalid_credentials";
  if (status === 403) {
    return /InvalidAccessKeyId|SignatureDoesNotMatch/i.test(body)
      ? "invalid_credentials"
      : "permission_denied";
  }
  return "unavailable";
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function faultFromError(e: unknown): { fault: StorageFault; message: string } {
  const name = e instanceof Error ? e.name : "";
  return {
    fault: name === "AbortError" ? "timeout" : "unavailable",
    message: e instanceof Error ? e.message : String(e),
  };
}

// ─── Operations ─────────────────────────────────────────────────────────

/** ListObjectsV2 (max-keys=1) — verifies credentials, region and bucket existence. */
export async function testStorageConnection(
  cfg: StorageConfig,
  opts?: { now?: Date; timeoutMs?: number },
): Promise<StorageResult<{ latencyMs: number }>> {
  const t0 = Date.now();
  const signed = signRequest(cfg, {
    method: "GET",
    path: "",
    query: { "list-type": "2", "max-keys": "1" },
    now: opts?.now,
  });
  try {
    const res = await fetchWithTimeout(signed.url.toString(), { method: "GET", headers: signed.headers }, opts?.timeoutMs);
    const latencyMs = Date.now() - t0;
    if (res.ok) return { ok: true, status: res.status, data: { latencyMs } };
    const body = await res.text().catch(() => "");
    if (res.status === 404) return { ok: false, fault: "not_found", status: 404, message: "Bucket not found", data: { latencyMs } };
    return { ok: false, fault: classifyStatus(res.status, body), status: res.status, message: `Provider rejected (${res.status})`, data: { latencyMs } };
  } catch (e) {
    const { fault, message } = faultFromError(e);
    return { ok: false, fault, message, data: { latencyMs: Date.now() - t0 } };
  }
}

export async function storagePutObject(
  cfg: StorageConfig,
  path: string,
  body: Buffer | string,
  contentType: string,
  opts?: { now?: Date; timeoutMs?: number },
): Promise<StorageResult<{ key: string; size: number }>> {
  const signed = signRequest(cfg, { method: "PUT", path, body, contentType, now: opts?.now });
  try {
    const res = await fetchWithTimeout(signed.url.toString(), { method: "PUT", headers: signed.headers, body: body as BodyInit }, opts?.timeoutMs);
    if (res.ok) return { ok: true, status: res.status, data: { key: path, size: body.length } };
    const text = await res.text().catch(() => "");
    return { ok: false, fault: classifyStatus(res.status, text), status: res.status, message: `Upload failed (${res.status})` };
  } catch (e) {
    const { fault, message } = faultFromError(e);
    return { ok: false, fault, message };
  }
}
export async function storageGetObject(
  cfg: StorageConfig,
  path: string,
  opts?: { now?: Date; timeoutMs?: number },
): Promise<StorageResult<{ body: Buffer; contentType: string; key: string }>> {
  const signed = signRequest(cfg, { method: "GET", path, now: opts?.now });
  try {
    const res = await fetchWithTimeout(signed.url.toString(), { method: "GET", headers: signed.headers }, opts?.timeoutMs);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, fault: classifyStatus(res.status, text), status: res.status, message: `Retrieval failed (${res.status})` };
    }
    return {
      ok: true,
      status: res.status,
      data: { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream", key: path },
    };
  } catch (e) {
    const { fault, message } = faultFromError(e);
    return { ok: false, fault, message };
  }
}

export async function storageDeleteObject(
  cfg: StorageConfig,
  path: string,
  opts?: { now?: Date; timeoutMs?: number },
): Promise<StorageResult<{ key: string }>> {
  const signed = signRequest(cfg, { method: "DELETE", path, now: opts?.now });
  try {
    const res = await fetchWithTimeout(signed.url.toString(), { method: "DELETE", headers: signed.headers }, opts?.timeoutMs);
    if (res.ok) return { ok: true, status: res.status, data: { key: path } };
    const text = await res.text().catch(() => "");
    return { ok: false, fault: classifyStatus(res.status, text), status: res.status, message: `Delete failed (${res.status})` };
  } catch (e) {
    const { fault, message } = faultFromError(e);
    return { ok: false, fault, message };
  }
}

export async function storageListKeys(
  cfg: StorageConfig,
  prefix: string,
  opts?: { now?: Date; timeoutMs?: number },
): Promise<StorageResult<{ keys: string[] }>> {
  const signed = signRequest(cfg, { method: "GET", path: "", query: { "list-type": "2", prefix }, now: opts?.now });
  try {
    const res = await fetchWithTimeout(signed.url.toString(), { method: "GET", headers: signed.headers }, opts?.timeoutMs);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, fault: classifyStatus(res.status, text), status: res.status, message: `List failed (${res.status})` };
    }
    const xml = await res.text();
    const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1] ?? "");
    return { ok: true, status: 200, data: { keys } };
  } catch (e) {
    const { fault, message } = faultFromError(e);
    return { ok: false, fault, message };
  }
}

/** Presigned GET URL — safe for direct browser downloads without exposing keys. */
export function presignStorageGetUrl(
  cfg: StorageConfig,
  path: string,
  expiresInSec = 3_600,
  opts?: { now?: Date },
): string | null {
  const now = opts?.now ?? new Date();
  const amzDate = isoBasic(now);
  const dateScope = amzDate.slice(0, 8);
  const scope = `${dateScope}/${cfg.region}/s3/aws4_request`;
  const host = hostHeaderFor(cfg);
  const rawQuery: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${cfg.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSec)],
    ["X-Amz-SignedHeaders", "host"],
    ["X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD"],
  ];
  const sortedQuery = rawQuery.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalQuery = sortedQuery.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canonicalRequest = `GET\n${canonicalUriFor(cfg, path)}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonicalRequest)}`;
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateScope);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const url = buildObjectUrl(cfg, path);
  url.search = `${canonicalQuery}&X-Amz-Signature=${encodeURIComponent(signature)}`;
  return url.toString();
}

// ─── Persisted config (AcquisitionProfile.integrations.storage) ─────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type TxLike = {
  acquisitionProfile: {
    findFirst: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function readPersistedStorageConfig(
  tx: TxLike,
  tenantId: string,
): Promise<OpaqueStorageConfig | null> {
  const profile = await tx.acquisitionProfile.findFirst({
    where: { tenantId },
    select: { id: true, integrations: true },
  });
  const storage = (profile?.integrations as any)?.storage;
  if (!storage || typeof storage !== "object") return null;
  if (typeof storage.cred !== "string" || !storage.bucket) return null;
  return storage as OpaqueStorageConfig;
}

export async function writePersistedStorageConfig(
  tx: TxLike,
  tenantId: string,
  cfg: OpaqueStorageConfig | null,
): Promise<boolean> {
  const profile = await tx.acquisitionProfile.findFirst({
    where: { tenantId },
    select: { id: true, integrations: true },
  });
  if (!profile) return false;
  const integrations = (profile.integrations as Record<string, unknown>) ?? {};
  if (cfg === null) delete integrations.storage;
  else integrations.storage = cfg;
  await tx.acquisitionProfile.update({
    where: { id: profile.id },
    data: { integrations, version: { increment: 1 } },
  });
  return true;
}

/** Resolve the runtime config (decrypt credentials) — null when not ready. */
export async function buildRuntimeStorageConfig(
  tx: TxLike,
  tenantId: string,
): Promise<StorageConfig | null> {
  const persisted = await readPersistedStorageConfig(tx, tenantId);
  if (!persisted) return null;
  const cred = decryptStorageCredentials(persisted.cred);
  if (!cred) return null;
  return {
    provider: "s3",
    bucket: persisted.bucket,
    region: persisted.region,
    endpoint: persisted.endpoint,
    accessKeyId: cred.accessKeyId,
    secretAccessKey: cred.secretAccessKey,
  };
}
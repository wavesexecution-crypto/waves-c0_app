import crypto from "node:crypto";
import { withTenantContext } from "@wavesco/db";
import { recordActivity } from "./activity";
import {
  storageDelete,
  storageExists,
  storagePut,
  wavesObjectKey,
  wavesStorageConfig,
  type ResolvedStorage,
} from "./object-storage";
import { isTenantPath } from "./storage";

/**
 * Artifact lifecycle — the authoritative rulebook for client binary data.
 *
 * OWNERSHIP (machine-readable, asserted by tests):
 *   upload  — CLIENT DATA. Tenant's own files (CSV/XLSX/JSON imports).
 *   report  — CLIENT DATA. Archived PDF/XLSX deliverables, per batch.
 *   export  — CLIENT DATA. Persisted on-demand exports (transient ones are
 *             never stored — see below).
 *   artifact— CLIENT DATA. Other generated tenant files.
 *
 * LIFECYCLE: PENDING → READY → DELETED (tombstone row kept).
 * EXPIRY ≠ DELETION: losing access never deletes bytes. Only explicit
 * owner delete or operator purge removes them, both audited.
 *
 * EPHEMERAL BY DESIGN (never persisted): per-request leads CSV downloads,
 * in-memory previews, Notify Hub base64 payloads, scheduler log tails.
 *
 * LEAD ENGINE SQLITE — ownership boundary: the engine corpus
 * (leads.db + reports/ + exports/ + runs/ on the engine host) is
 * WAVES-OWNED research infrastructure: a shared, non-tenant research
 * library, NOT the client record. Postgres is the ONE authoritative
 * representation of client-facing data. Engine outreach-state columns
 * (date_contacted, reply_status, ...) are cross-tenant HINTS — Postgres
 * order/reply state is authoritative per tenant. If the engine SQLite
 * disappears: generate/discover report BLOCKED (honestly), while every
 * Postgres record, archived report and conversation remains servable.
 * Engine-local report files are TRANSIENT until archived here — archive
 * promotion (explicit endpoint, lazy on download, resend path, bulk
 * migration script) is what makes a report durable.
 */

export type ArtifactKind = "upload" | "report" | "export" | "artifact";

export interface OwnershipRule {
  owner: "client" | "waves" | "system";
  retention: string;
  deletableBy: "owner" | "operator" | "system";
  servesClient: boolean;
}

export const STORAGE_OWNERSHIP: Record<ArtifactKind | "ephemeral", OwnershipRule> = {
  upload: { owner: "client", retention: "until explicit owner delete or tenant purge", deletableBy: "owner", servesClient: true },
  report: { owner: "client", retention: "until explicit owner delete or tenant purge", deletableBy: "owner", servesClient: true },
  export: { owner: "client", retention: "persisted exports only; per-request downloads are ephemeral", deletableBy: "owner", servesClient: true },
  artifact: { owner: "client", retention: "until explicit owner delete or tenant purge", deletableBy: "owner", servesClient: true },
  ephemeral: { owner: "system", retention: "never persisted (request memory only)", deletableBy: "system", servesClient: false },
};

const KIND_SET = new Set<string>(["upload", "report", "export", "artifact"]);

export function isArtifactKind(v: unknown): v is ArtifactKind {
  return typeof v === "string" && KIND_SET.has(v);
}

type Tx = Parameters<Parameters<typeof withTenantContext>[1]>[0];

function storageEnv(): { config: ResolvedStorage } | { error: string } {
  return wavesStorageConfig();
}

export function maxUploadBytes(): number {
  const raw = Number(process.env.STORAGE_MAX_UPLOAD_MB ?? "10");
  const mb = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 10;
  return Math.floor(mb * 1024 * 1024);
}

const ALLOWED_EXT = new Set([".csv", ".xlsx", ".json"]);
const MIME_BY_EXT: Record<string, string> = {
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".json": "application/json",
};

export interface ValidatedUpload {
  ok: boolean;
  error?: string;
  ext?: string;
  mime?: string;
  rowCount?: number | null;
}

/** Validate bytes, never trusting client filename or MIME. Returns the
 *  sniffed type. Rejects oversized, wrong-extension, malformed and
 *  suspicious (NUL-containing, non-UTF8 CSV) payloads. */
export function validateUploadBytes(bytes: Buffer, filename: string): ValidatedUpload {
  if (bytes.length === 0) return { ok: false, error: "Empty file.", rowCount: null };
  if (bytes.length > maxUploadBytes()) {
    return { ok: false, error: `File exceeds the ${Math.floor(maxUploadBytes() / 1048576)} MB upload limit.` };
  }
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  if (!ALLOWED_EXT.has(ext)) return { ok: false, error: "Only .csv, .xlsx and .json files are accepted." };
  if (bytes.includes(0)) return { ok: false, error: "File contains binary data inconsistent with its type." };
  if (ext === ".xlsx") {
    // ZIP container: local-file-header signature + end-of-central-directory.
    if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      return { ok: false, error: "Not a valid .xlsx (ZIP container expected)." };
    }
    if (bytes.lastIndexOf(Buffer.from("PK\x05\x06")) < 0) {
      return { ok: false, error: "Truncated .xlsx (missing end-of-central-directory)." };
    }
    return { ok: true, ext, mime: MIME_BY_EXT[ext], rowCount: null };
  }
  if (ext === ".json") {
    try {
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (!parsed || (typeof parsed !== "object" && !Array.isArray(parsed))) {
        return { ok: false, error: "JSON must be an object or array." };
      }
    } catch {
      return { ok: false, error: "Malformed JSON." };
    }
    return { ok: true, ext, mime: MIME_BY_EXT[ext], rowCount: null };
  }
  // .csv — must be valid UTF-8 text with at least a header line.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { ok: false, error: "CSV has no data rows." };
    return { ok: true, ext, mime: MIME_BY_EXT[ext], rowCount: Math.max(0, lines.length - 1) };
  } catch {
    return { ok: false, error: "CSV is not valid UTF-8 text." };
  }
}

export function sha256hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export interface StoreResult {
  ok: boolean;
  objectId?: string;
  objectKey?: string;
  sizeBytes?: number;
  sha256?: string;
  mime?: string;
  error?: string;
}

/** Persist an upload: validate → generated tenant-scoped key → provider put
 *  → READY registry row. Never trusts client paths; key always generated. */
export async function storeUpload(
  tenantId: string,
  userId: string | null | undefined,
  input: { bytes: Buffer; filename: string },
  purpose?: string,
): Promise<StoreResult> {
  const v = validateUploadBytes(input.bytes, input.filename);
  if (!v.ok || !v.mime) return { ok: false, error: v.error ?? "Upload rejected." };
  const mime: string = v.mime;
  const resolved = storageEnv();
  if ("error" in resolved) return { ok: false, error: `Storage unavailable: ${resolved.error}` };
  const id = `obj_${crypto.randomUUID().replace(/-/g, "")}`;
  const key = wavesObjectKey(tenantId, "uploads", id, input.filename);
  if (!isTenantPath(tenantId, key)) return { ok: false, error: "Generated key failed tenant scoping (internal error)." };
  const put = await storagePut(resolved.config, tenantId, key, input.bytes, mime);
  if (!put.ok) return { ok: false, error: `Object store write failed: ${put.message ?? put.fault ?? "unknown"}` };
  const sha = sha256hex(input.bytes);
  const row = await withTenantContext(
    tenantId,
    async (tx: Tx) => {
      const created = await tx.storedObject.create({
        data: {
          tenantId, kind: "upload", fileName: input.filename.slice(0, 200),
          mime, sizeBytes: input.bytes.length, sha256: sha,
          provider: resolved.config.provider,
          bucket: resolved.config.provider === "s3" ? resolved.config.s3.bucket : null,
          objectKey: key, status: "READY", createdByUserId: userId ?? null,
          meta: { purpose: (purpose ?? "import").slice(0, 120), rowCount: v.rowCount },
        },
      });
      await recordActivitySafe(tenantId, {
        type: "storage_upload",
        title: `File uploaded: ${input.filename.slice(0, 80)}`,
        entityType: "stored_object", entityId: created.id, href: "/acquisition/reports",
        metadata: { objectId: created.id, sizeBytes: input.bytes.length, sha256: sha },
      });
      return created;
    },
    userId ?? undefined,
  );
  return { ok: true, objectId: row.id, objectKey: key, sizeBytes: input.bytes.length, sha256: sha, mime };
}

async function recordActivitySafe(tenantId: string, a: Parameters<typeof recordActivity>[1]): Promise<void> {
  try {
    await recordActivity(tenantId, a);
  } catch {
    // activity is observability, never load-bearing for the mutation itself
  }
}

export interface ArchiveResult {
  archived: { objectId: string; filename: string; mime: string }[];
  skipped: string[];
  failures: { file: string; reason: string }[];
}

/** Promote engine-local report files for a batch into durable storage.
 *  Idempotent per (tenant, batchId, filename): re-runs skip existing READY
 *  rows. Bytes source: remote engine API, else engine-host local paths.
 *  Never throws — failures are returned explicitly for the caller to log. */
export async function archiveBatchReports(
  tenantId: string,
  batchId: string,
  userId?: string | null,
): Promise<ArchiveResult> {
  const out: ArchiveResult = { archived: [], skipped: [], failures: [] };
  const resolved = storageEnv();
  if ("error" in resolved) {
    return { archived: [], skipped: [], failures: [{ file: batchId, reason: `Storage unavailable: ${resolved.error}` }] };
  }
  const { fetchManifestFile, getBatchManifest, leadEngineMode } = await import("./lead-engine");
  const { existsSync, readFileSync } = await import("node:fs");
  const remote = leadEngineMode() === "remote";

  async function bytesFor(type: "pdf" | "xlsx"): Promise<{ body: Buffer; mime: string } | null> {
    if (remote) {
      const f = await fetchManifestFile(batchId, type).catch(() => null);
      if (!f?.ok) return null;
      return { body: Buffer.from(f.body), mime: type === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    }
    const manifest = (await getBatchManifest(batchId).catch(() => undefined)) ?? null;
    if (!manifest) return null;
    const p = type === "pdf" ? manifest.pdfPath : manifest.excelPath;
    if (!p || !existsSync(p)) return null;
    try {
      return {
        body: readFileSync(p),
        mime: type === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    } catch {
      return null;
    }
  }

  for (const type of ["pdf", "xlsx"] as const) {
    const filename = `${batchId}.${type}`;
    try {
      const existing = await withTenantContext(tenantId, async (tx: Tx) =>
        tx.storedObject.findFirst({ where: { tenantId, batchId, kind: "report", status: "READY" } }),
      );
      // Idempotency is per file: skip only when THIS file is already archived.
      const dupe = existing && (existing as { fileName?: string }).fileName === filename ? existing : null;
      if (dupe) {
        out.skipped.push(filename);
        continue;
      }
      const data = await bytesFor(type);
      if (!data) {
        out.failures.push({ file: filename, reason: "Source bytes not available on the engine host." });
        continue;
      }
      const id = `obj_${crypto.randomUUID().replace(/-/g, "")}`;
      const key = wavesObjectKey(tenantId, "reports", id, filename);
      const put = await storagePut(resolved.config, tenantId, key, data.body, data.mime);
      if (!put.ok) {
        out.failures.push({ file: filename, reason: `Object store write failed: ${put.message ?? put.fault ?? "unknown"}` });
        continue;
      }
      const row = await withTenantContext(
        tenantId,
        async (tx: Tx) =>
          tx.storedObject.create({
            data: {
              tenantId, kind: "report", batchId, fileName: filename, mime: data.mime,
              sizeBytes: data.body.length, sha256: sha256hex(data.body),
              provider: resolved.config.provider,
              bucket: resolved.config.provider === "s3" ? resolved.config.s3.bucket : null,
              objectKey: key, status: "READY", createdByUserId: userId ?? null,
              meta: { archivedFrom: remote ? "engine-remote" : "engine-local" },
            },
          }),
        userId ?? undefined,
      );
      out.archived.push({ objectId: row.id, filename, mime: data.mime });
      await recordActivitySafe(tenantId, {
        type: "storage_archive",
        title: `Report archived: ${filename}`,
        entityType: "stored_object", entityId: row.id, href: "/acquisition/reports",
        metadata: { batchId, objectId: row.id },
      });
    } catch (e) {
      out.failures.push({ file: filename, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export interface ReconcileResult {
  checked: number;
  missing: { objectId: string; fileName: string; objectKey: string }[];
}

/** Verify every READY object still has bytes. Missing bytes are marked
 *  MISSING (row kept) + activity alert — never silently left as READY. */
export async function reconcileStorage(tenantId: string): Promise<ReconcileResult> {
  const resolved = storageEnv();
  if ("error" in resolved) return { checked: 0, missing: [] };
  const rows = await withTenantContext(tenantId, async (tx: Tx) =>
    tx.storedObject.findMany({ where: { tenantId, status: "READY" }, select: { id: true, fileName: true, objectKey: true } }),
  );
  const missing: ReconcileResult["missing"] = [];
  for (const r of rows) {
    let present = false;
    try {
      present = await storageExists(resolved.config, tenantId, r.objectKey);
    } catch {
      present = false;
    }
    if (!present) {
      missing.push({ objectId: r.id, fileName: r.fileName, objectKey: r.objectKey });
      await withTenantContext(tenantId, async (tx: Tx) => {
        await tx.storedObject.update({ where: { id: r.id }, data: { status: "MISSING" } });
      }).catch((e: unknown) => {
        console.error(`[storage] reconcile mark-missing failed for ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
  }
  if (missing.length > 0) {
    await recordActivitySafe(tenantId, {
      type: "storage_missing",
      title: `${missing.length} stored file(s) missing bytes`,
      entityType: "stored_object", href: "/acquisition/reports",
      metadata: { missing: missing.map((m) => ({ objectId: m.objectId, fileName: m.fileName })) },
    });
  }
  return { checked: rows.length, missing };
}

export interface PurgeResult {
  objects: number;
  bytesDeleted: number;
  failed: { objectId: string; reason: string }[];
}

/** Explicit tenant purge (operator/GDPR path): delete bytes best-effort per
 *  object, mark every row DELETED with timestamp. Idempotent — re-runs find
 *  nothing left to do. Expiry never calls this (EXPIRY ≠ DELETION). */
export async function purgeTenantObjects(
  tenantId: string,
  actor: string,
): Promise<PurgeResult> {
  const resolved = storageEnv();
  if ("error" in resolved) return { objects: 0, bytesDeleted: 0, failed: [{ objectId: "*", reason: resolved.error }] };
  const rows = await withTenantContext(tenantId, async (tx: Tx) =>
    tx.storedObject.findMany({ where: { tenantId, status: { not: "DELETED" } } }),
  );
  const out: PurgeResult = { objects: 0, bytesDeleted: 0, failed: [] };
  for (const r of rows) {
    try {
      const del = await storageDelete(resolved.config, tenantId, r.objectKey);
      if (!del.ok) {
        out.failed.push({ objectId: r.id, reason: del.message ?? del.fault ?? "delete failed" });
        continue;
      }
      await withTenantContext(tenantId, async (tx: Tx) => {
        await tx.storedObject.update({ where: { id: r.id }, data: { status: "DELETED", deletedAt: new Date() } });
      });
      out.objects += 1;
      out.bytesDeleted += Number.isFinite(r.sizeBytes) ? r.sizeBytes : 0;
    } catch (e) {
      out.failed.push({ objectId: r.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  await recordActivitySafe(tenantId, {
    type: "storage_purge",
    title: `Tenant storage purge: ${out.objects} object(s), ${out.bytesDeleted} bytes`,
    entityType: "stored_object", href: "/acquisition/reports",
    metadata: { actor, ...out },
  });
  return out;
}

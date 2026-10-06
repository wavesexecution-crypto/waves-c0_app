/**
 * Storage ownership kernel — the single authority on "whose bytes are these?".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The previous model had ONE field, `STORAGE_OWNERSHIP[kind].owner`, and set it
 * to "client" for every servable kind. That was false on its own terms: `owner`
 * was being asked to answer two different questions at once.
 *
 *   1. Whose BUSINESS DATA is this?          → `subject`
 *   2. Whose INFRASTRUCTURE holds the bytes?  → `custody`
 *
 * "client" answered (1) and silently implied (2). In reality every persisted
 * byte was written to a Waves-operated bucket using Waves credentials, so
 * custody was "waves-held" for 100% of rows. The assertion was decorative.
 *
 * The real model, now machine-readable and enforced:
 *
 *   AUTHORITATIVE OWNERSHIP KEY = `StoredObject.tenantId`.
 *   Nothing else is an owner. `objectKey`, `fileName`, `batchId`, `provider`
 *   and `bucket` are LOCATORS. A locator never grants access. Every read,
 *   update and delete resolves ownership by a composite `(id, tenantId)` or
 *   `(tenantId, batchId)` lookup inside the tenant transaction BEFORE any byte
 *   or disk I/O happens, and every storage call is additionally prefix-guarded
 *   by `isTenantPath(tenantId, key)`.
 *
 *   SUBJECT — whose business data the row represents.
 *     "client"  the tenant's own data. Must never cross a tenant boundary.
 *     "system"  Waves operational data (never client-servable).
 *
 *   CUSTODY — which infrastructure physically holds the bytes.
 *     "waves-held"         Waves-operated bucket/local dir, platform credentials.
 *     "client-controlled"  the tenant's OWN bucket, the tenant's own credentials.
 *
 *   Custody is ENFORCED, not asserted: it is persisted on the row, and every
 *   read/delete resolves the storage target FROM THE ROW. A row written to the
 *   client's bucket is read back from the client's bucket. If a row's recorded
 *   bucket disagrees with the resolved bucket, the operation fails closed
 *   rather than silently reading the wrong location.
 *
 *   SIGNED URLS — none are issued, by policy. `downloadUrlPolicy()` is the
 *   machine-readable statement of that, and it is asserted by tests. All bytes
 *   are proxied through a session-authenticated, tenant-checked route with
 *   `cache-control: no-store`. There is no bearer-style URL to leak.
 */

import type { ResolvedStorage } from "./object-storage";
import { wavesStorageConfig } from "./object-storage";
import { buildRuntimeStorageConfig, isTenantPath } from "./storage";

/* ------------------------------------------------------------------ */
/* Axes                                                               */
/* ------------------------------------------------------------------ */

/** Whose business data a row represents. */
export type DataSubject = "client" | "system";

/** Whose infrastructure physically holds the bytes. */
export type Custody = "waves-held" | "client-controlled";

export const WAVES_HELD: Custody = "waves-held";
export const CLIENT_CONTROLLED: Custody = "client-controlled";

export function isCustody(v: unknown): v is Custody {
  return v === WAVES_HELD || v === CLIENT_CONTROLLED;
}

/** Custody recorded on a row that predates the column. Waves-held is the
 *  historical truth for every row written before client-controlled writes
 *  existed, so the backfill default is correct rather than merely safe. */
export function normalizeCustody(v: unknown): Custody {
  return isCustody(v) ? v : WAVES_HELD;
}

export type ArtifactKind = "upload" | "report" | "export" | "artifact" | "ephemeral";

export interface OwnershipRule {
  /** Whose business data this is. */
  subject: DataSubject;
  /** Where the bytes live. Enforced per row, not inherited from this table. */
  custody: Custody;
  retention: string;
  deletableBy: "owner" | "operator" | "system";
  servesClient: boolean;
}

/**
 * The rulebook. `subject` and `custody` are SEPARATE axes on purpose —
 * collapsing them is what made the previous `owner: "client"` untrue.
 *
 * `custody` here is the DEFAULT a writer should use. A writer that targets the
 * tenant's own bucket records `client-controlled` on the row it writes; the
 * read path follows the row, never this table.
 */
export const STORAGE_OWNERSHIP: Record<ArtifactKind, OwnershipRule> = {
  upload: {
    subject: "client",
    custody: WAVES_HELD,
    retention: "until explicit owner delete or tenant purge",
    deletableBy: "owner",
    servesClient: true,
  },
  report: {
    subject: "client",
    custody: WAVES_HELD,
    retention: "until explicit owner delete or tenant purge",
    deletableBy: "owner",
    servesClient: true,
  },
  export: {
    subject: "client",
    custody: WAVES_HELD,
    retention: "persisted exports only; per-request downloads are ephemeral",
    deletableBy: "owner",
    servesClient: true,
  },
  artifact: {
    subject: "client",
    custody: WAVES_HELD,
    retention: "until explicit owner delete or tenant purge",
    deletableBy: "owner",
    servesClient: true,
  },
  ephemeral: {
    subject: "system",
    custody: WAVES_HELD,
    retention: "never persisted (request memory only)",
    deletableBy: "system",
    servesClient: false,
  },
};

/* ------------------------------------------------------------------ */
/* Signed URL policy                                                  */
/* ------------------------------------------------------------------ */

export interface DownloadUrlPolicy {
  /** Signed/presigned URLs are never issued. */
  signedUrls: false;
  mechanism: "authenticated-route-proxy";
  urlLifetime: "session";
  cacheControl: "no-store";
  /** Provider credentials never appear in a response or a URL. */
  credentialsInUrl: false;
}

export function downloadUrlPolicy(): DownloadUrlPolicy {
  return {
    signedUrls: false,
    mechanism: "authenticated-route-proxy",
    urlLifetime: "session",
    cacheControl: "no-store",
    credentialsInUrl: false,
  };
}

/* ------------------------------------------------------------------ */
/* Row shape                                                          */
/* ------------------------------------------------------------------ */

export interface StoredObjectRow {
  id: string;
  tenantId: string;
  kind: string;
  batchId: string | null;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  provider: string;
  bucket: string | null;
  objectKey: string;
  status: string;
  createdByUserId?: string | null;
  custody?: string | null;
  deletedAt?: Date | null;
  [k: string]: unknown;
}

/** Minimal tx surface — keeps this module testable with a fake tx. */
export interface OwnershipTx {
  storedObject: {
    findFirst: (args: unknown) => Promise<unknown>;
    findMany?: (args: unknown) => Promise<unknown>;
  };
  generationBatch?: {
    findFirst: (args: unknown) => Promise<unknown>;
  };
}

/* ------------------------------------------------------------------ */
/* Enforcement — ownership proofs                                     */
/* ------------------------------------------------------------------ */

/**
 * Resolve a stored object BY OWNER, never by id alone.
 *
 * The `tenantId` in the predicate is the whole security boundary. A caller that
 * passes an id belonging to another tenant gets `null` — indistinguishable from
 * a row that does not exist, so this cannot be used to probe for the existence
 * of another tenant's objects.
 */
export async function loadOwnedStoredObject(
  tx: OwnershipTx,
  tenantId: string,
  id: string,
): Promise<StoredObjectRow | null> {
  if (!tenantId || !id) return null;
  const row = (await tx.storedObject.findFirst({
    where: { id, tenantId },
  })) as StoredObjectRow | null;
  return row ?? null;
}

/**
 * Prove a lead-engine batch belongs to this tenant.
 *
 * The engine corpus (`leads.db` + `runs/*.json` + `reports/` + `exports/`) is a
 * single SHARED, tenant-less namespace on the engine host. A batch id alone
 * therefore identifies nothing. A batch is ours only when it is linked to us:
 *
 *   - a `GenerationBatch` row with this `engineBatchId`, OR
 *   - an already-archived `StoredObject` row with this `batchId`
 *
 * Call this BEFORE any manifest resolution, disk read or object-store call.
 */
export async function tenantOwnsBatch(
  tx: OwnershipTx,
  tenantId: string,
  batchId: string,
): Promise<boolean> {
  if (!tenantId || !batchId) return false;
  try {
    if (tx.generationBatch) {
      const linked = await tx.generationBatch.findFirst({
        where: { tenantId, engineBatchId: batchId },
        select: { id: true },
      });
      if (linked) return true;
    }
  } catch {
    // fall through to the archived-object proof
  }
  try {
    const archived = await tx.storedObject.findFirst({
      where: { tenantId, batchId, kind: "report" },
      select: { id: true },
    });
    if (archived) return true;
  } catch {
    return false;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Enforcement — custody resolution                                    */
/* ------------------------------------------------------------------ */

export type CustodyTarget =
  | { ok: true; custody: Custody; config: ResolvedStorage; bucket: string | null }
  | { ok: false; reason: string };

/**
 * Resolve WHERE a specific row's bytes live.
 *
 * Custody comes from the ROW, not from ambient environment. This is the
 * enforcement that the old model lacked: previously every read and delete
 * resolved the Waves-held bucket globally and ignored `row.bucket`, so bytes
 * that had been written to a tenant's own bucket would have been looked for in
 * the wrong place — and, worse, a row's recorded location was never checked
 * against the location actually being read.
 *
 * Fail-closed rules:
 *   - unknown/blank tenantId → refuse
 *   - key outside the tenant prefix → refuse
 *   - custody says client-controlled but no usable tenant credentials → refuse
 *   - row's recorded bucket disagrees with the resolved bucket → refuse
 */
export async function resolveCustodyTarget(
  tx: OwnershipTx,
  tenantId: string,
  row: StoredObjectRow,
): Promise<CustodyTarget> {
  if (!tenantId || !row) return { ok: false, reason: "missing tenant or object" };
  if (row.tenantId !== tenantId) return { ok: false, reason: "object is not owned by this tenant" };
  if (!isTenantPath(tenantId, row.objectKey)) return { ok: false, reason: "object key is outside the tenant scope" };

  const custody = normalizeCustody(row.custody);
  const recordedBucket = row.bucket ?? null;

  if (custody === CLIENT_CONTROLLED) {
    const cfg = await buildRuntimeStorageConfig(tx as never, tenantId);
    if (!cfg) return { ok: false, reason: "client-controlled storage has no usable connection" };
    if (recordedBucket && cfg.bucket.toLowerCase() !== recordedBucket.toLowerCase()) {
      return {
        ok: false,
        reason: `recorded bucket does not match the tenant's connected bucket (${recordedBucket})`,
      };
    }
    return { ok: true, custody, config: { provider: "s3", s3: cfg }, bucket: cfg.bucket };
  }

  const waves = wavesStorageConfig();
  if ("error" in waves) return { ok: false, reason: waves.error };
  const bucket = waves.config.provider === "s3" ? waves.config.s3.bucket : null;
  if (recordedBucket && bucket && recordedBucket.toLowerCase() !== bucket.toLowerCase()) {
    return {
      ok: false,
      reason: `recorded bucket does not match the Waves-held bucket (${recordedBucket})`,
    };
  }
  return { ok: true, custody, config: waves.config, bucket };
}

/** The Waves-held target. Used only when creating NEW rows. */
export function resolveWavesHeldTarget(): CustodyTarget {
  const waves = wavesStorageConfig();
  if ("error" in waves) return { ok: false, reason: waves.error };
  return {
    ok: true,
    custody: WAVES_HELD,
    config: waves.config,
    bucket: waves.config.provider === "s3" ? waves.config.s3.bucket : null,
  };
}

/**
 * The tenant's own bucket, if it has a usable connection. Used only when
 * creating NEW rows that should live in client-controlled storage.
 */
export async function resolveClientControlledTarget(
  tx: OwnershipTx,
  tenantId: string,
): Promise<CustodyTarget> {
  if (!tenantId) return { ok: false, reason: "missing tenant" };
  const cfg = await buildRuntimeStorageConfig(tx as never, tenantId);
  if (!cfg) return { ok: false, reason: "client-controlled storage has no usable connection" };
  return { ok: true, custody: CLIENT_CONTROLLED, config: { provider: "s3", s3: cfg }, bucket: cfg.bucket };
}
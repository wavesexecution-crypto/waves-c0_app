import { withTenantContext, ensureDefaultPreferences } from "@wavesco/db";

// Waves Identity → Tenant → Acquisition OS Entitlement (authoritative).
//
// SINGLE SOURCE OF TRUTH: `AcquisitionEntitlement` (one row per tenant).
// The legacy derived read (TenantModule acquisition-os/enabled) is kept ONLY
// as a fallback signal for tenants provisioned before this table existed —
// it can report at most active/inactive/not_configured and never overrides
// an explicit entitlement row.
//
// Lifecycle:
//   (none) → TRIAL → ACTIVE | EXPIRED
//   TRIAL → EXPIRED (lazy on read + expiry sweep)
//   ACTIVE → EXPIRED | SUSPENDED | CANCELLED | REFUNDED
//   EXPIRED → ACTIVE (renewal)
//   SUSPENDED → ACTIVE | CANCELLED
//   CANCELLED / REFUNDED are terminal.
//
// Provider-agnostic: grants record `source`/`provider` as free text
// (TRIAL, MANUAL, IMPORT, ...). No payment-gateway code lives here.

export type ProductId = "acquisition-os";
export type EntitlementStatus =
  | "trial"
  | "active"
  | "expired"
  | "suspended"
  | "cancelled"
  | "refunded"
  | "inactive"
  | "not_configured";

export interface Entitlement {
  product: ProductId;
  status: EntitlementStatus;
  reason: string;
  tenantModuleId?: string | null;
  enabledAt?: string | null;
  /** Authoritative row id (null when derived from legacy TenantModule). */
  entitlementId?: string | null;
  startedAt?: string | null;
  expiresAt?: string | null;
  trialExpiresAt?: string | null;
  /** True when we could not read the entitlement at all (database down).
   *  Never treat this as "not rented" — the client is entitled, we just
   *  cannot prove it right now. */
  readFailed?: boolean;
}

/** Trial length for self-serve trials. Operator policy, not pricing. */
export const TRIAL_DAYS_DEFAULT = 14;

/** Access is granted while trialing or active. Everything else is blocked. */
export function hasAccess(status: EntitlementStatus): boolean {
  return status === "trial" || status === "active";
}

type DbStatus = "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "SUSPENDED";

function mapRow(e: {
  id: string;
  status: string;
  startedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  trialExpiresAt?: Date | string | null;
}): Entitlement {
  const iso = (v: Date | string | null | undefined) =>
    v ? new Date(v).toISOString() : null;
  const base = {
    product: "acquisition-os" as const,
    entitlementId: e.id,
    startedAt: iso(e.startedAt),
    expiresAt: iso(e.expiresAt),
    trialExpiresAt: iso(e.trialExpiresAt),
  };
  switch (e.status as DbStatus) {
    case "TRIAL":
      return { ...base, status: "trial", reason: "Trial active — complete your profile to get value from it." };
    case "ACTIVE":
      return { ...base, status: "active", reason: "Entitlement active — rented" };
    case "EXPIRED":
      return { ...base, status: "expired", reason: "Access expired — renew to resume operating." };
    case "SUSPENDED":
      return { ...base, status: "suspended", reason: "Access suspended — contact Waves to restore." };
    case "CANCELLED":
      return { ...base, status: "cancelled", reason: "Access cancelled." };
    case "REFUNDED":
      return { ...base, status: "refunded", reason: "Access refunded and revoked." };
    default:
      // An unrecognised status must never silently deny access. Log loudly so
      // a new value is visible before it locks every tenant holding it out.
      console.warn(`[entitlements] unrecognised AcquisitionEntitlement status "${e.status}" — mapped to inactive`);
      return { ...base, status: "inactive", reason: `Entitlement ${e.status}` };
  }
}

async function readLegacy(tenantId: string): Promise<Entitlement> {
  const result = await withTenantContext(tenantId, async (tx) => {
    const mod = await tx.module.findUnique({ where: { name: "acquisition-os" }, select: { id: true, name: true } });
    if (!mod) return { found: false as const, mod: null, tm: null };
    const tm = await tx.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      select: { id: true, status: true, enabledAt: true },
    });
    return { found: true as const, mod, tm };
  });
  if (!result.found) {
    return { product: "acquisition-os", status: "not_configured", reason: "acquisition-os module not registered" };
  }
  const tm: any = result.tm;
  if (!tm) {
    return { product: "acquisition-os", status: "not_configured", reason: "Not rented — no entitlement record. Rent via Waves." };
  }
  if (tm.status === "enabled") {
    return {
      product: "acquisition-os",
      status: "active",
      reason: "Entitlement active — rented",
      tenantModuleId: tm.id,
      enabledAt: tm.enabledAt ? new Date(tm.enabledAt).toISOString() : null,
    };
  }
  return {
    product: "acquisition-os",
    status: "inactive",
    reason: `Entitlement ${tm.status}`,
    tenantModuleId: tm.id,
    enabledAt: tm.enabledAt ? new Date(tm.enabledAt).toISOString() : null,
  };
}

/** Lazy expiry flip. Returns the (possibly updated) row or null. */
async function applyLazyExpiry(tenantId: string): Promise<any | null> {
  return withTenantContext(tenantId, async (tx) => {
    const e = await tx.acquisitionEntitlement.findUnique({ where: { tenantId } });
    if (!e) return null;
    const now = new Date();
    if (e.status === "TRIAL" && e.trialExpiresAt && new Date(e.trialExpiresAt) < now) {
      return tx.acquisitionEntitlement.update({ where: { tenantId }, data: { status: "EXPIRED" } });
    }
    if (e.status === "ACTIVE" && e.expiresAt && new Date(e.expiresAt) < now) {
      return tx.acquisitionEntitlement.update({ where: { tenantId }, data: { status: "EXPIRED" } });
    }
    return e;
  });
}

export async function getAcquisitionOSEntitlement(tenantId: string): Promise<Entitlement> {
  try {
    const row = await applyLazyExpiry(tenantId);
    if (row) return mapRow(row);
  } catch (e) {
    // The table may not exist on a database migrated before this release, so
    // fall through to the legacy read. A real outage fails there too and is
    // reported as readFailed below rather than as "not rented".
    console.warn("[entitlements] authoritative read failed, trying legacy read", e);
  }
  try {
    return await readLegacy(tenantId);
  } catch (e) {
    // Both reads failed. This is an outage, not a billing state — the client
    // must never be told their access was never purchased, and must never see
    // the driver's message.
    console.error("[entitlements] entitlement lookup failed", e);
    return {
      product: "acquisition-os",
      status: "not_configured",
      reason: "We could not verify your access just now. This is a temporary problem on our side — try again in a moment.",
      readFailed: true,
    };
  }
}

/** Throws ENTITLEMENT_REQUIRED (with `status` 402/403) when access is denied. */
export async function requireAcquisitionAccess(tenantId: string): Promise<Entitlement> {
  const e = await getAcquisitionOSEntitlement(tenantId);
  if (hasAccess(e.status)) return e;
  const err: any = new Error(`ENTITLEMENT_REQUIRED: ${e.reason}`);
  err.status = e.status === "not_configured" || e.status === "inactive" ? 403 : 402;
  err.entitlement = e;
  throw err;
}

/** Map an ENTITLEMENT_REQUIRED throw to an HTTP status + payload, or null. */
export function entitlementDeniedPayload(e: unknown): { status: number; body: Record<string, unknown> } | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.startsWith("ENTITLEMENT_REQUIRED")) return null;
  const err = e as { status?: number; entitlement?: Entitlement };
  return {
    status: err.status === 403 ? 403 : 402,
    body: {
      error: "entitlement_required",
      reason: err.entitlement?.reason ?? msg,
      status: err.entitlement?.status ?? "unknown",
      whatNext: "Complete onboarding and activate your trial, or renew access from Billing.",
    },
  };
}

/** Trial may only be started by an owner/admin — matches the billing page. */
export function canStartTrial(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

// ------------------------------------------------------------------
// Provisioning — deterministic, idempotent, never partially silent.
// A newly entitled tenant automatically receives: TenantModule (enabled),
// AcquisitionProfile (DRAFT), ClientAiConfig (disabled default),
// NotificationPreferences (15 defaults). Every step reports; any failure
// throws with the failing step named so the caller can show WHAT failed,
// WHY, and that retry is safe.
// ------------------------------------------------------------------

export interface ProvisionStep {
  step: "module" | "profile" | "ai_config" | "preferences";
  created: boolean;
}

export interface ProvisionResult {
  tenantId: string;
  steps: ProvisionStep[];
  alreadyProvisioned: boolean;
}

export async function provisionAcquisitionOS(tenantId: string, userId?: string | null): Promise<ProvisionResult> {
  const steps: ProvisionStep[] = [];
  const fail = (step: ProvisionStep["step"], reason: string): never => {
    const err: any = new Error(`PROVISION_FAILED [${step}]: ${reason}`);
    err.step = step;
    throw err;
  };
  try {
    await withTenantContext(
      tenantId,
      async (tx) => {
        // 1. Module must be registered, then enabled for this tenant.
        const mod = await tx.module.findUnique({ where: { name: "acquisition-os" } });
        if (!mod) {
          fail("module", "acquisition-os module is not registered. Contact Waves.");
          throw new Error("unreachable");
        }
        const existingTm = await tx.tenantModule.findUnique({
          where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
        });
        if (!existingTm || existingTm.status !== "enabled") {
          await tx.tenantModule.upsert({
            where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
            create: { tenantId, moduleId: mod.id, status: "enabled", enabledAt: new Date() },
            update: { status: "enabled", enabledAt: new Date(), disabledAt: null },
          });
          steps.push({ step: "module", created: !existingTm });
        } else {
          steps.push({ step: "module", created: false });
        }

        // 2. Profile shell (DRAFT) so onboarding always has a target row.
        const existingProfile = await tx.acquisitionProfile.findUnique({ where: { tenantId } });
        if (!existingProfile) {
          await tx.acquisitionProfile.create({ data: { tenantId, status: "DRAFT", version: 1 } });
          steps.push({ step: "profile", created: true });
        } else {
          steps.push({ step: "profile", created: false });
        }

        // 3. AI config default (disabled until the tenant opts in).
        const existingAi = await tx.clientAiConfig.findUnique({ where: { tenantId } });
        if (!existingAi) {
          await tx.clientAiConfig.create({
            data: { tenantId, aiEnabled: false, provider: "ollama_cloud" },
          });
          steps.push({ step: "ai_config", created: true });
        } else {
          steps.push({ step: "ai_config", created: false });
        }

        await tx.auditLog.create({
          data: {
            tenantId,
            userId: userId ?? null,
            action: "acquisition.provision",
            model: "Tenant",
            recordId: tenantId,
            after: { steps },
          },
        });
      },
      userId ?? undefined,
    );
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("PROVISION_FAILED")) throw e;
    throw new Error(`PROVISION_FAILED [unknown]: ${e instanceof Error ? e.message : String(e)}. Safe to retry — provisioning is idempotent.`);
  }

  // 4. Notification preferences (own context helper; idempotent by design).
  try {
    await ensureDefaultPreferences(tenantId);
    steps.push({ step: "preferences", created: false });
  } catch (e) {
    fail("preferences", e instanceof Error ? e.message : String(e));
  }

  return { tenantId, steps, alreadyProvisioned: steps.every((s) => !s.created) };
}

// ------------------------------------------------------------------
// Grants — trial + paid activation + lifecycle transitions.
// ------------------------------------------------------------------

export interface GrantResult {
  entitlement: Entitlement;
  created: boolean;
}

export async function startTrial(
  tenantId: string,
  userId?: string | null,
  days: number = TRIAL_DAYS_DEFAULT,
): Promise<GrantResult> {
  if (!Number.isFinite(days) || days < 1 || days > 60) {
    throw new Error("Trial length must be between 1 and 60 days.");
  }
  const existing = await getAcquisitionOSEntitlement(tenantId);
  if (existing.entitlementId && ["trial", "active"].includes(existing.status)) {
    const err: any = new Error("Trial already active — complete onboarding to use it.");
    err.status = 409;
    throw err;
  }
  if (existing.entitlementId && existing.status !== "not_configured") {
    // A prior EXPIRED/CANCELLED/etc row exists: single-use trial, no reset.
    const prior = await withTenantContext(tenantId, async (tx) =>
      tx.acquisitionEntitlement.findUnique({ where: { tenantId } }),
    );
    if (prior?.trialStartedAt) {
      const err: any = new Error("Trial already used — renew to resume access.");
      err.status = 409;
      throw err;
    }
  }
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86_400_000);
  const created = await withTenantContext(
    tenantId,
    async (tx) => {
      const row = await tx.acquisitionEntitlement.upsert({
        where: { tenantId },
        create: {
          tenantId, status: "TRIAL", source: "TRIAL",
          trialStartedAt: now, trialExpiresAt: expires,
        },
        update: { status: "TRIAL", source: "TRIAL", trialStartedAt: now, trialExpiresAt: expires },
      });
      await tx.auditLog.create({
        data: { tenantId, userId: userId ?? null, action: "acquisition.trial.start", model: "AcquisitionEntitlement", recordId: row.id, after: { days, trialExpiresAt: expires } },
      });
      return row;
    },
    userId ?? undefined,
  );
  await provisionAcquisitionOS(tenantId, userId);
  return { entitlement: mapRow(created), created: true };
}

export interface PaidGrant {
  provider?: string;
  providerRef?: string;
  idempotencyKey?: string;
  expiresAt?: Date | string;
  days?: number;
  amountPaise?: number;
  currency?: string;
  note?: string;
}

/** Operator/provider-agnostic paid activation. Validates, records the order
 *  idempotently, sets ACTIVE, provisions. Never invents an expiry: caller
 *  must supply `expiresAt` or `days`. */
export async function activatePaid(
  tenantId: string,
  grant: PaidGrant,
  userId?: string | null,
): Promise<GrantResult> {
  const provider = (grant.provider ?? "manual").trim().slice(0, 60) || "manual";
  let expiresAt: Date | null = null;
  if (grant.expiresAt) {
    expiresAt = new Date(grant.expiresAt);
  } else if (grant.days !== undefined) {
    if (!Number.isFinite(grant.days) || grant.days < 1 || grant.days > 732) {
      throw new Error("Grant days must be between 1 and 732.");
    }
    expiresAt = new Date(Date.now() + grant.days * 86_400_000);
  }
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new Error("A future expiry (expiresAt or days) is required to activate paid access.");
  }
  const idempotencyKey =
    grant.idempotencyKey?.trim().slice(0, 120) ||
    `grant:${tenantId}:${provider}:${expiresAt.toISOString()}`;
  const now = new Date();
  const row = await withTenantContext(
    tenantId,
    async (tx) => {
      const prior = await tx.acquisitionOrder.findUnique({ where: { idempotencyKey } });
      if (prior?.status === "VERIFIED") {
        const ent = await tx.acquisitionEntitlement.findUnique({ where: { tenantId } });
        if (ent) return ent;
      }
      if (!prior) {
        await tx.acquisitionOrder.create({
          data: {
            tenantId, status: "VERIFIED", provider,
            providerRef: grant.providerRef?.trim().slice(0, 120) || null,
            idempotencyKey,
            amountPaise: grant.amountPaise ?? null,
            currency: grant.currency ?? "INR",
            meta: { note: grant.note?.slice(0, 500) ?? null },
          },
        });
      } else if (prior.status !== "VERIFIED") {
        await tx.acquisitionOrder.update({ where: { id: prior.id }, data: { status: "VERIFIED" } });
      }
      const order = await tx.acquisitionOrder.findUnique({ where: { idempotencyKey } });
      const ent = await tx.acquisitionEntitlement.upsert({
        where: { tenantId },
        create: {
          tenantId, status: "ACTIVE", source: provider.toUpperCase().slice(0, 20),
          startedAt: now, expiresAt, orderId: order!.id,
        },
        update: { status: "ACTIVE", startedAt: now, expiresAt, orderId: order!.id },
      });
      await tx.auditLog.create({
        data: { tenantId, userId: userId ?? null, action: "acquisition.grant.paid", model: "AcquisitionEntitlement", recordId: ent.id, after: { provider, expiresAt, orderId: order!.id } },
      });
      return ent;
    },
    userId ?? undefined,
  );
  await provisionAcquisitionOS(tenantId, userId);
  return { entitlement: mapRow(row), created: true };
}

const TERMINAL = new Set(["CANCELLED", "REFUNDED"]);

export async function transitionEntitlement(
  tenantId: string,
  action: "suspend" | "resume" | "cancel" | "refund" | "renew",
  opts: { reason?: string; days?: number; expiresAt?: Date | string } = {},
  userId?: string | null,
): Promise<GrantResult> {
  const row = await withTenantContext(
    tenantId,
    async (tx) => {
      const e = await tx.acquisitionEntitlement.findUnique({ where: { tenantId } });
      if (!e) throw new Error("No entitlement record — start a trial or grant access first.");
      const now = new Date();
      let data: Record<string, unknown> = {};
      let audit = "";
      switch (action) {
        case "suspend":
          if (!["ACTIVE", "TRIAL"].includes(e.status)) throw new Error(`Cannot suspend from ${e.status}.`);
          data = { status: "SUSPENDED", suspendedAt: now };
          audit = "acquisition.grant.suspend";
          break;
        case "resume":
          if (e.status !== "SUSPENDED") throw new Error(`Can only resume from SUSPENDED, current ${e.status}.`);
          data = { status: "ACTIVE", suspendedAt: null };
          if (!e.expiresAt || new Date(e.expiresAt) < now) {
            throw new Error("Cannot resume an expired grant — renew instead.");
          }
          audit = "acquisition.grant.resume";
          break;
        case "cancel":
          if (TERMINAL.has(e.status)) throw new Error(`Already ${e.status}.`);
          data = { status: "CANCELLED", cancelReason: opts.reason?.slice(0, 300) ?? null };
          audit = "acquisition.grant.cancel";
          break;
        case "refund":
          if (e.status === "REFUNDED") throw new Error("Already refunded.");
          data = { status: "REFUNDED", cancelReason: opts.reason?.slice(0, 300) ?? "refunded" };
          audit = "acquisition.grant.refund";
          break;
        case "renew": {
          if (TERMINAL.has(e.status)) throw new Error(`Cannot renew a ${e.status} grant.`);
          let exp: Date | null = null;
          if (opts.expiresAt) exp = new Date(opts.expiresAt);
          else if (opts.days !== undefined) {
            if (!Number.isFinite(opts.days) || opts.days < 1 || opts.days > 732) throw new Error("Renewal days must be between 1 and 732.");
            const base = e.expiresAt && new Date(e.expiresAt) > now ? new Date(e.expiresAt) : now;
            exp = new Date(base.getTime() + opts.days * 86_400_000);
          }
          if (!exp || Number.isNaN(exp.getTime()) || exp.getTime() <= now.getTime()) {
            throw new Error("Renewal requires a future expiresAt or positive days.");
          }
          data = { status: "ACTIVE", startedAt: e.startedAt ?? now, expiresAt: exp, suspendedAt: null, cancelReason: null };
          audit = "acquisition.grant.renew";
          break;
        }
      }
      const updated = await tx.acquisitionEntitlement.update({ where: { tenantId }, data });
      await tx.auditLog.create({
        data: { tenantId, userId: userId ?? null, action: audit, model: "AcquisitionEntitlement", recordId: updated.id, before: { status: e.status }, after: data },
      });
      return updated;
    },
    userId ?? undefined,
  );
  return { entitlement: mapRow(row), created: false };
}

/** Expiry sweep for the scheduler. Idempotent. Returns per-status counts.
 *  The candidate scan uses the owner-role client: the runtime role has no
 *  tenant context here, so an RLS-bound query would silently return zero
 *  rows and the sweep would expire nothing. Per-tenant updates below still
 *  run inside withTenantContext (RLS-scoped + audited). */
export async function expireDueEntitlements(): Promise<{ checked: number; expired: number }> {
  const { directPrisma } = await import("@wavesco/db");
  const now = new Date();
  const due = await directPrisma().acquisitionEntitlement.findMany({
    where: {
      OR: [
        { status: "TRIAL", trialExpiresAt: { lt: now } },
        { status: "ACTIVE", expiresAt: { lt: now } },
      ],
    },
    select: { tenantId: true },
  });
  let expired = 0;
  for (const d of due) {
    try {
      await withTenantContext(d.tenantId, async (tx) => {
        const e = await tx.acquisitionEntitlement.findUnique({ where: { tenantId: d.tenantId } });
        if (!e) return;
        const past =
          (e.status === "TRIAL" && e.trialExpiresAt && new Date(e.trialExpiresAt) < new Date()) ||
          (e.status === "ACTIVE" && e.expiresAt && new Date(e.expiresAt) < new Date());
        if (!past) return;
        await tx.acquisitionEntitlement.update({ where: { tenantId: d.tenantId }, data: { status: "EXPIRED" } });
        await tx.auditLog.create({
          data: { tenantId: d.tenantId, action: "acquisition.grant.expired", model: "AcquisitionEntitlement", recordId: e.id, before: { status: e.status } },
        });
        expired++;
      });
    } catch {
      // One bad tenant must not stop the sweep; recorded via missed count.
    }
  }
  return { checked: due.length, expired };
}

// Contract for future billing — payment providers plug in via activatePaid.
export interface BillingContract {
  product: ProductId;
  checkout: (tenantId: string) => Promise<{ url: string }>; // Choose → Rent → Pay
  verify: (tenantId: string, sessionId: string) => Promise<Entitlement>;
  entitlement: (tenantId: string) => Promise<Entitlement>;
}

export const acquisitionOSProduct = {
  id: "acquisition-os" as const,
  name: "Acquisition OS",
  tagline: "Choose. Rent. Operate.",
  description: "The rented acquisition operating system. One complete OS while subscription active.",
} as const;

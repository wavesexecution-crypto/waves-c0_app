/**
 * Entitlement authority — trial/activate/transitions/provision/expiry/gating.
 * Synthetic tenants only. No network, no payment provider.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
const mem = {
  acquisitionEntitlement: [] as Row[],
  acquisitionOrder: [] as Row[],
  module: [] as Row[],
  tenantModule: [] as Row[],
  acquisitionProfile: [] as Row[],
  clientAiConfig: [] as Row[],
  notificationPreference: [] as Row[],
  auditLog: [] as Row[],
};
let seq = 1;
const nid = (p: string) => `${p}_${seq++}`;

function makeTx() {
  return {
    acquisitionEntitlement: {
      findUnique: async ({ where }: any) => mem.acquisitionEntitlement.find((r) => r.tenantId === where.tenantId) ?? null,
      update: async ({ where, data }: any) => {
        const r = mem.acquisitionEntitlement.find((x) => x.tenantId === where.tenantId)!;
        Object.assign(r, data);
        return r;
      },
      upsert: async ({ where, create, update }: any) => {
        const existing: Row | undefined = mem.acquisitionEntitlement.find((x) => x.tenantId === where.tenantId);
        if (!existing) {
          const row: Row = { id: nid("ent"), ...create };
          mem.acquisitionEntitlement.push(row);
          return row;
        }
        Object.assign(existing, update);
        return existing;
      },
    },
    acquisitionOrder: {
      findUnique: async ({ where }: any) => {
        if (where.idempotencyKey) return mem.acquisitionOrder.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null;
        if (where.id) return mem.acquisitionOrder.find((r) => r.id === where.id) ?? null;
        return null;
      },
      create: async ({ data }: any) => {
        if (mem.acquisitionOrder.some((r) => r.idempotencyKey === data.idempotencyKey)) {
          const e: any = new Error("Unique constraint failed"); e.code = "P2002"; throw e;
        }
        const r = { id: nid("ord"), ...data };
        mem.acquisitionOrder.push(r);
        return r;
      },
      update: async ({ where, data }: any) => {
        const r = mem.acquisitionOrder.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
      findMany: async ({ where }: any = {}) => mem.acquisitionOrder.filter((r) => r.tenantId === (where as any)?.tenantId || !(where as any)?.tenantId),
    },
    module: { findUnique: async ({ where }: any) => mem.module.find((m) => m.name === where.name) ?? null },
    tenantModule: {
      findUnique: async ({ where }: any) => {
        const k = where.tenantId_moduleId;
        return mem.tenantModule.find((r) => r.tenantId === k.tenantId && r.moduleId === k.moduleId) ?? null;
      },
      upsert: async ({ where, create, update }: any) => {
        const k = where.tenantId_moduleId;
        const existing: Row | undefined = mem.tenantModule.find((x) => x.tenantId === k.tenantId && x.moduleId === k.moduleId);
        if (!existing) {
          const row: Row = { id: nid("tm"), ...create };
          mem.tenantModule.push(row);
          return row;
        }
        Object.assign(existing, update);
        return existing;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of mem.tenantModule) {
          if ((!where.tenantId || r.tenantId === where.tenantId) &&
              (!where.moduleId || r.moduleId === where.moduleId)) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      },
    },
    acquisitionProfile: {
      findUnique: async ({ where }: any) => mem.acquisitionProfile.find((r) => r.tenantId === where.tenantId) ?? null,
      create: async ({ data }: any) => { const r = { id: nid("prof"), ...data }; mem.acquisitionProfile.push(r); return r; },
    },
    clientAiConfig: {
      findUnique: async ({ where }: any) => mem.clientAiConfig.find((r) => r.tenantId === where.tenantId) ?? null,
      create: async ({ data }: any) => { const r = { id: nid("ai"), ...data }; mem.clientAiConfig.push(r); return r; },
    },
    notificationPreference: {
      findMany: async () => mem.notificationPreference.map((r) => ({ category: r.category, channel: r.channel })),
      createMany: async ({ data }: any) => { for (const d of data) mem.notificationPreference.push({ id: nid("np"), ...d }); return { count: data.length }; },
    },
    auditLog: { create: async ({ data }: any) => { const r = { id: nid("audit"), ...data }; mem.auditLog.push(r); return r; } },
  };
}

const ENT_ACTIVE = () => ({
  id: "ent1", tenantId: "t1", status: "ACTIVE", source: "MANUAL",
  trialStartedAt: null, trialExpiresAt: null,
  startedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86_400_000),
});

vi.mock("@wavesco/db", () => ({
  withTenantContext: async (_tid: string, fn: any, _uid?: string) => fn(makeTx()),
  ensureDefaultPreferences: async (tenantId: string) => {
    const tx: any = makeTx();
    const existing: any[] = await tx.notificationPreference.findMany();
    const have = new Set(existing.map((e) => `${e.category}:${e.channel}`));
    const cats = ["cycle_milestones", "reports", "campaign_activity", "responses", "action_required"];
    const chans = ["in_app", "email", "push"];
    const missing = cats.flatMap((c) => chans.filter((ch) => !have.has(`${c}:${ch}`)).map((ch) => ({ tenantId, category: c, channel: ch, enabled: true })));
    if (missing.length) await tx.notificationPreference.createMany({ data: missing });
  },
  prisma: {
    tenant: { findMany: async () => [{ id: "t1" }, { id: "t2" }] },
    acquisitionEntitlement: {
      findMany: async ({ where }: any) => {
        const ors = where?.OR ?? [];
        return mem.acquisitionEntitlement.filter((r) => ors.some((o: any) => {
          if (o.status === "TRIAL" && r.status === "TRIAL" && r.trialExpiresAt) return new Date(r.trialExpiresAt) < new Date();
          if (o.status === "ACTIVE" && r.status === "ACTIVE" && r.expiresAt) return new Date(r.expiresAt) < new Date();
          return false;
        }));
      },
    },
  },
  directPrisma: () => ({
    tenant: { findMany: async () => [{ id: "t1" }, { id: "t2" }] },
    acquisitionEntitlement: {
      findMany: async ({ where }: any) => {
        const ors = where?.OR ?? [];
        return mem.acquisitionEntitlement.filter((r) => ors.some((o: any) => {
          if (o.status === "TRIAL" && r.status === "TRIAL" && r.trialExpiresAt) return new Date(r.trialExpiresAt) < new Date();
          if (o.status === "ACTIVE" && r.status === "ACTIVE" && r.expiresAt) return new Date(r.expiresAt) < new Date();
          return false;
        }));
      },
    },
  }),
}));

import {
  getAcquisitionOSEntitlement, hasAccess, requireAcquisitionAccess,
  startTrial, activatePaid, transitionEntitlement, provisionAcquisitionOS,
  expireDueEntitlements, TRIAL_DAYS_DEFAULT,
} from "@/lib/wavesco/entitlements";

beforeEach(() => {
  for (const k of Object.keys(mem)) (mem as any)[k] = [];
  seq = 1;
  mem.module.push({ id: "mod_acq", name: "acquisition-os" });
  vi.clearAllMocks();
});

describe("entitlement authority", () => {
  it("no records anywhere → not_configured (never fake-active)", async () => {
    mem.module.length = 0;
    const e = await getAcquisitionOSEntitlement("ghost");
    expect(e.status).toBe("not_configured");
    expect(hasAccess(e.status)).toBe(false);
  });
  it("legacy TenantModule enabled still reports active (backward compat)", async () => {
    mem.tenantModule.push({ id: "tm1", tenantId: "t1", moduleId: "mod_acq", status: "enabled", enabledAt: new Date() });
    const e = await getAcquisitionOSEntitlement("t1");
    expect(e.status).toBe("active");
    expect(hasAccess(e.status)).toBe(true);
  });
  it("authoritative row wins over legacy module state", async () => {
    mem.tenantModule.push({ id: "tm1", tenantId: "t1", moduleId: "mod_acq", status: "enabled", enabledAt: new Date() });
    mem.acquisitionEntitlement.push({ ...ENT_ACTIVE(), status: "EXPIRED", expiresAt: new Date(Date.now() - 1000) });
    const e = await getAcquisitionOSEntitlement("t1");
    expect(e.status).toBe("expired");
    expect(e.entitlementId).toBe("ent1");
  });
  it("lazy expiry flips TRIAL/ACTIVE on read", async () => {
    mem.acquisitionEntitlement.push({ ...ENT_ACTIVE(), status: "TRIAL", trialStartedAt: new Date(Date.now() - 20 * 86_400_000), trialExpiresAt: new Date(Date.now() - 1000) });
    expect((await getAcquisitionOSEntitlement("t1")).status).toBe("expired");
  });
  it("requireAcquisitionAccess: trial/active pass; expired → 402; missing → 403", async () => {
    mem.module.length = 0;
    await expect(requireAcquisitionAccess("ghost")).rejects.toThrow(/ENTITLEMENT_REQUIRED/);
    try { await requireAcquisitionAccess("ghost"); } catch (e: any) { expect(e.status).toBe(403); }
    mem.acquisitionEntitlement.push({ ...ENT_ACTIVE(), status: "EXPIRED", expiresAt: new Date(Date.now() - 1000) });
    try { await requireAcquisitionAccess("t1"); expect.unreachable(); } catch (e: any) { expect(e.status).toBe(402); }
    mem.acquisitionEntitlement[0]!.status = "ACTIVE";
    mem.acquisitionEntitlement[0]!.expiresAt = new Date(Date.now() + 86_400_000);
    await expect(requireAcquisitionAccess("t1")).resolves.toMatchObject({ status: "active" });
  });
});

describe("trial grants", () => {
  it("starts a trial with default length and provisions automatically", async () => {
    expect(TRIAL_DAYS_DEFAULT).toBeGreaterThanOrEqual(1);
    const { entitlement, created } = await startTrial("t1", "u1");
    expect(created).toBe(true);
    expect(entitlement.status).toBe("trial");
    expect(hasAccess(entitlement.status)).toBe(true);
    // auto-provisioned defaults exist
    expect(mem.tenantModule).toHaveLength(1);
    expect(mem.acquisitionProfile).toHaveLength(1);
    expect(mem.clientAiConfig).toHaveLength(1);
    expect(mem.notificationPreference.length).toBe(15);
    expect(mem.auditLog.some((a) => a.action === "acquisition.trial.start")).toBe(true);
  });
  it("second trial is refused 409 (single-use)", async () => {
    await startTrial("t1", "u1");
    await expect(startTrial("t1", "u1")).rejects.toMatchObject({ status: 409 });
  });
  it("expired trial cannot restart vitro trial (must renew)", async () => {
    await startTrial("t1", "u1");
    mem.acquisitionEntitlement[0]!.status = "EXPIRED";
    await expect(startTrial("t1", "u1")).rejects.toMatchObject({ status: 409 });
  });
  it("the proof period is locked to 2 days — no caller may lengthen it", async () => {
    // The commercial model is a fixed 2-day proof. This used to accept any
    // length in 1..60, which silently granted 14 days by default.
    await expect(startTrial("t1", "u1", 0)).rejects.toThrow(/fixed at 2 days/);
    await expect(startTrial("t1", "u1", 14)).rejects.toThrow(/fixed at 2 days/);
    await expect(startTrial("t1", "u1", 60)).rejects.toThrow(/fixed at 2 days/);
  });

  it("a default trial lasts 2 days, not 14", async () => {
    const { entitlement } = await startTrial("t1", "u1");
    const days = Math.round(
      (new Date(entitlement.trialExpiresAt as string).getTime() - Date.now()) / 86_400_000,
    );
    expect(days).toBe(2);
  });
});

describe("paid activation (provider-agnostic)", () => {
  it("requires a future expiry — never invents one", async () => {
    await expect(activatePaid("t1", {}, "u1")).rejects.toThrow(/future expiry/i);
    await expect(activatePaid("t1", { expiresAt: new Date(Date.now() - 1000).toISOString() }, "u1")).rejects.toThrow(/future expiry/i);
    await expect(activatePaid("t1", { days: 0 }, "u1")).rejects.toThrow(/between 1 and 732/);
  });
  it("activates ACTIVE + records order + provisions, idempotent on retry", async () => {
    const g = { provider: "manual", providerRef: "UPI-REF-1", idempotencyKey: "k1", days: 30 };
    const r1 = await activatePaid("t1", g, "u1");
    expect(r1.entitlement.status).toBe("active");
    expect(mem.acquisitionOrder).toHaveLength(1);
    expect(mem.acquisitionOrder[0]).toMatchObject({ status: "VERIFIED", provider: "manual", providerRef: "UPI-REF-1" });
    expect(mem.tenantModule).toHaveLength(1);
    const r2 = await activatePaid("t1", g, "u1");
    expect(mem.acquisitionOrder).toHaveLength(1);
    expect(r2.entitlement.status).toBe("active");
  });

  it("a second paid grant EXTENDS from the remaining paid time, never truncates it", async () => {
    // Regression: the expiry was computed from `now`, so a customer 80 days
    // into a 365-day lease who bought 90 days silently lost those 80 paid days.
    await activatePaid("t1", { days: 365 }, "u1");
    const remaining = 80 * 86_400_000;
    mem.acquisitionEntitlement[0]!.expiresAt = new Date(Date.now() + remaining);
    const startedBefore = new Date(mem.acquisitionEntitlement[0]!.startedAt);

    await activatePaid("t1", { days: 90, idempotencyKey: "k2" }, "u1");
    const after = new Date(mem.acquisitionEntitlement[0]!.expiresAt).getTime();
    const expected = Date.now() + remaining + 90 * 86_400_000;
    // 90 days were added to the 80 remaining — nothing was thrown away.
    expect(Math.abs(after - expected)).toBeLessThan(5_000);
    // And the original start of paid tenure is preserved.
    expect(new Date(mem.acquisitionEntitlement[0]!.startedAt).getTime()).toBe(
      startedBefore.getTime(),
    );
  });

  it("a paid grant consumes the single-use trial marker", async () => {
    await startTrial("t1", "u1");
    await activatePaid("t1", { days: 30 }, "u1");
    // The trial must not become available again after paying.
    expect(mem.acquisitionEntitlement[0]!.trialStartedAt).not.toBeNull();
    await expect(startTrial("t1", "u1")).rejects.toThrow(/already/i);
  });
});

describe("lifecycle transitions", () => {
  async function active() {
    await activatePaid("t1", { days: 30 }, "u1");
  }
  it("suspend → resume; resume of expired grant refused", async () => {
    await active();
    expect((await transitionEntitlement("t1", "suspend", {}, "u1")).entitlement.status).toBe("suspended");
    expect((await transitionEntitlement("t1", "resume", {}, "u1")).entitlement.status).toBe("active");
    await expect(transitionEntitlement("t1", "resume", {}, "u1")).rejects.toThrow(/only resume from SUSPENDED/i);
    mem.acquisitionEntitlement[0]!.status = "SUSPENDED";
    mem.acquisitionEntitlement[0]!.expiresAt = new Date(Date.now() - 1000);
    await expect(transitionEntitlement("t1", "resume", {}, "u1")).rejects.toThrow(/renew instead/i);
  });
  it("cancel is sticky; refund terminal; renew extends from current expiry", async () => {
    await active();
    expect((await transitionEntitlement("t1", "cancel", { reason: "churn" }, "u1")).entitlement.status).toBe("cancelled");
    await expect(transitionEntitlement("t1", "cancel", {}, "u1")).rejects.toThrow(/Already/i);
    await expect(transitionEntitlement("t1", "renew", { days: 30 }, "u1")).rejects.toThrow(/Cannot renew/i);
    mem.acquisitionEntitlement[0]!.status = "EXPIRED";
    const before = new Date(mem.acquisitionEntitlement[0]!.expiresAt);
    const r = await transitionEntitlement("t1", "renew", { days: 30 }, "u1");
    expect(r.entitlement.status).toBe("active");
    expect(new Date(r.entitlement.expiresAt!).getTime()).toBeGreaterThan(before.getTime());
  });
  it("suspend from EXPIRED refused; unknown grant refused", async () => {
    await expect(transitionEntitlement("ghost", "suspend", {}, "u1")).rejects.toThrow(/No entitlement record/i);
    await active();
    mem.acquisitionEntitlement[0]!.status = "EXPIRED";
    await expect(transitionEntitlement("t1", "suspend", {}, "u1")).rejects.toThrow(/Cannot suspend/i);
  });

  it("refund clears the legacy TenantModule flag", async () => {
    // Regression: refunds only changed the entitlement row. The pre-migration
    // `TenantModule` flag stayed `enabled`, so the legacy fallback reported
    // `active` for a refunded tenant whenever the authoritative read errored.
    await active();
    expect(mem.tenantModule[0]!.status).toBe("enabled");
    await transitionEntitlement("t1", "refund", { reason: "refund requested" }, "u1");
    expect(mem.acquisitionEntitlement[0]!.status).toBe("REFUNDED");
    expect(mem.tenantModule[0]!.status).toBe("disabled");
  });

  it("suspend clears the legacy TenantModule flag too", async () => {
    await active();
    await transitionEntitlement("t1", "suspend", { reason: "non-payment" }, "u1");
    expect(mem.acquisitionEntitlement[0]!.status).toBe("SUSPENDED");
    expect(mem.tenantModule[0]!.status).toBe("disabled");
  });
});

describe("provisioning", () => {
  it("is idempotent — second run creates nothing new", async () => {
    const r1 = await provisionAcquisitionOS("t1", "u1");
    expect(r1.alreadyProvisioned).toBe(false);
    expect(r1.steps).toHaveLength(4);
    const counts = [mem.tenantModule.length, mem.acquisitionProfile.length, mem.clientAiConfig.length, mem.notificationPreference.length];
    const r2 = await provisionAcquisitionOS("t1", "u1");
    expect(r2.alreadyProvisioned).toBe(true);
    expect([mem.tenantModule.length, mem.acquisitionProfile.length, mem.clientAiConfig.length, mem.notificationPreference.length]).toEqual(counts);
  });
  it("fails loudly with the step named when the module is not registered", async () => {
    mem.module.length = 0;
    await expect(provisionAcquisitionOS("t1", "u1")).rejects.toThrow(/PROVISION_FAILED \[module\]/);
  });
});

describe("expiry sweep", () => {
  it("expires only due rows, audits each, never touches live ones", async () => {
    mem.acquisitionEntitlement.push({ ...ENT_ACTIVE(), tenantId: "t1", status: "ACTIVE", expiresAt: new Date(Date.now() - 1000) });
    mem.acquisitionEntitlement.push({ ...ENT_ACTIVE(), tenantId: "t2", id: "ent2", status: "ACTIVE", expiresAt: new Date(Date.now() + 86_400_000) });
    const r = await expireDueEntitlements();
    expect(r).toEqual({ checked: 1, expired: 1 });
    expect(mem.acquisitionEntitlement.find((e) => e.tenantId === "t1")!.status).toBe("EXPIRED");
    expect(mem.acquisitionEntitlement.find((e) => e.tenantId === "t2")!.status).toBe("ACTIVE");
    expect(mem.auditLog.some((a) => a.action === "acquisition.grant.expired")).toBe(true);
  });
});

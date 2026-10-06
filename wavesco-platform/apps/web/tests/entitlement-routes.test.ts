/**
 * Route tests: entitlement endpoints, conversions, ingest, cron scheduler.
 * Synthetic tenants only. Auth mocked; no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  leadConversion: [] as Row[],
  followUp: [] as Row[],
  activityEvent: [] as Row[],
  conversation: [] as Row[],
  conversationMessage: [] as Row[],
  outreachOrder: [] as Row[],
  leadResearch: [] as Row[],
};
let seq = 1;
const nid = (p: string) => `${p}_${seq++}`;

let sessionRole = "owner";
vi.mock("@/lib/wavesco/control", () => ({
  requireControlAuth: async () => ({
    tenantId: "t1", userId: "u1",
    session: { user: { id: "u1", tenantId: "t1", role: sessionRole } },
  }),
  acquisitionDenied: vi.fn(async () => null),
  auditControl: vi.fn(async () => ({ id: "a1" })),
  sessionRole: (s: unknown) => {
    const user = (s as { user?: { role?: unknown } } | null)?.user;
    const role = (user as { role?: unknown } | null)?.role;
    return role === "owner" || role === "admin" || role === "member" ? (role as string) : "member";
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", tenantId: "t1", role: sessionRole } })) }));

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
        return mem.acquisitionOrder.find((r) => r.id === where.id) ?? null;
      },
      create: async ({ data }: any) => { const r = { id: nid("ord"), ...data }; mem.acquisitionOrder.push(r); return r; },
      update: async ({ where, data }: any) => {
        const r = mem.acquisitionOrder.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
      findMany: async () => [...mem.acquisitionOrder],
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
    leadConversion: {
      findUnique: async ({ where }: any) => {
        const k = where.tenantId_leadKey;
        return mem.leadConversion.find((r) => r.tenantId === k.tenantId && r.leadKey === k.leadKey) ?? null;
      },
      create: async ({ data }: any) => { const r = { id: nid("conv"), ...data }; mem.leadConversion.push(r); return r; },
      update: async ({ where, data }: any) => {
        const r = mem.leadConversion.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
      findMany: async () => [...mem.leadConversion],
    },
    followUp: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of mem.followUp) {
          const okTenant = !where.tenantId || r.tenantId === where.tenantId;
          const okLead = !where.leadKey || r.leadKey === where.leadKey;
          const okStatus = !where.status || r.status === where.status;
          if (okTenant && okLead && okStatus) { Object.assign(r, data); count++; }
        }
        return { count };
      },
    },
    activityEvent: { create: async ({ data }: any) => { const r = { id: nid("act"), ...data }; mem.activityEvent.push(r); return r; } },
    conversation: {
      findUnique: async ({ where }: any) => {
        if (where.id) return mem.conversation.find((r) => r.id === where.id) ?? null;
        const k = where.tenantId_leadKey;
        return mem.conversation.find((r) => r.tenantId === k.tenantId && r.leadKey === k.leadKey) ?? null;
      },
      findFirst: async ({ where }: any) => mem.conversation.find((r) => r.tenantId === (where as any).tenantId) ?? null,
      create: async ({ data }: any) => { const r = { id: nid("conv"), ...data }; mem.conversation.push(r); return r; },
      update: async ({ where, data }: any) => {
        const r = mem.conversation.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
    conversationMessage: {
      findFirst: async ({ where }: any) => mem.conversationMessage.find((r) => r.providerMsgId === (where as any).providerMsgId) ?? null,
      create: async ({ data }: any) => { const r = { id: nid("msg"), ...data }; mem.conversationMessage.push(r); return r; },
    },
    outreachOrder: {
      findFirst: async () => mem.outreachOrder[0] ?? null,
      findMany: async () => [...mem.outreachOrder],
      update: async ({ where, data }: any) => {
        const r = mem.outreachOrder.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
      updateMany: async () => ({ count: 0 }),
    },
    leadResearch: {
      findUnique: async ({ where }: any) => {
        const k = where.tenantId_leadKey;
        return mem.leadResearch.find((r) => r.tenantId === k.tenantId && r.leadKey === k.leadKey) ?? null;
      },
      findFirst: async ({ where }: any) => mem.leadResearch.find((r) => r.tenantId === (where as any)?.tenantId) ?? null,
    },
  };
}

vi.mock("@wavesco/db", () => ({
  withTenantContext: async (_tid: string, fn: any) => fn(makeTx()),
  ensureDefaultPreferences: async () => {},
  directPrisma: () => ({
    tenant: { findMany: async () => [] },
    acquisitionEntitlement: { findMany: async () => [] },
  }),
  prisma: {
    tenant: { findMany: async () => [] },
    acquisitionEntitlement: { findMany: async () => [] },
  },
}));
vi.mock("@/lib/wavesco/lead-engine", () => ({
  openReadonly: () => ({ prepare: () => ({ get: () => undefined, all: () => [] }), close: () => {} }),
  updateLeadOutreachState: async () => ({}),
}));

const OLD_ENV = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(mem)) (mem as any)[k] = [];
  seq = 1;
  sessionRole = "owner";
  mem.module.push({ id: "mod_acq", name: "acquisition-os" });
  delete process.env.CRON_SECRET;
  delete process.env.ACQUISITION_INGEST_KEY;
  vi.clearAllMocks();
});
/** Register an afterEach that restores process.env, optionally with extra cleanup. */
function afterEachRoute(extra?: () => void) {
  afterEach(() => {
    process.env = { ...OLD_ENV };
    extra?.();
  });
}
// Whole-file default; describes below add their own teardown on top.
afterEachRoute();

function req(body?: unknown, headers?: Record<string, string>) {
  return new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/acquisition/entitlement", () => {
  it("returns not_configured + hasAccess false for fresh tenants", async () => {
    const { GET } = await import("@/app/api/acquisition/entitlement/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.entitlement.status).toBe("not_configured");
    expect(j.hasAccess).toBe(false);
  });
});

describe("POST trial", () => {
  it("member → 403; owner → 200 trial with access; repeat → 409", async () => {
    const { POST } = await import("@/app/api/acquisition/entitlement/trial/route");
    sessionRole = "member";
    expect((await POST()).status).toBe(403);
    sessionRole = "owner";
    const r1 = await POST();
    expect(r1.status).toBe(200);
    const j1: any = await r1.json();
    expect(j1.entitlement.status).toBe("trial");
    expect(j1.hasAccess).toBe(true);
    expect(j1.whatNext).toMatch(/Company Profile/);
    expect((await POST()).status).toBe(409);
  });
});

describe("POST activate", () => {
  // The workspace `owner` role is NOT an operator. Granting paid access
  // off-band requires ACQUISITION_GRANT_KEY; otherwise any tenant owner could
  // mint themselves a year of paid access for nothing.
  const OP = { "x-acquisition-grant-key": "test-operator-key" };

  beforeEach(() => {
    process.env.ACQUISITION_GRANT_KEY = "test-operator-key";
  });
  afterEachRoute(() => {
    delete process.env.ACQUISITION_GRANT_KEY;
  });

  it("owner without the operator key → 403 even with a plausible body", async () => {
    const { POST } = await import("@/app/api/acquisition/entitlement/activate/route");
    sessionRole = "owner";
    const r = await POST(req({ days: 30, amountPaise: 1 }));
    expect(r.status).toBe(403);
    expect(mem.acquisitionEntitlement).toHaveLength(0);
  });

  it("member → 403; wrong operator key → 403", async () => {
    const { POST } = await import("@/app/api/acquisition/entitlement/activate/route");
    sessionRole = "member";
    expect((await POST(req({ leaseType: "LEASE_30" }, OP))).status).toBe(403);
    sessionRole = "owner";
    const r = await POST(req({ leaseType: "LEASE_30" }, { "x-acquisition-grant-key": "wrong" }));
    expect(r.status).toBe(403);
    expect(mem.acquisitionEntitlement).toHaveLength(0);
  });

  it("operator key + valid leaseType → 200, amount derived from the price table", async () => {
    const { POST } = await import("@/app/api/acquisition/entitlement/activate/route");
    const r = await POST(
      req({ leaseType: "LEASE_90", providerRef: "UPI-1", idempotencyKey: "kk" }, OP),
    );
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.entitlement.status).toBe("active");
    expect(j.hasAccess).toBe(true);
    // Duration and amount come from LEASE_PRICES, not the request.
    expect(mem.acquisitionOrder[0]!.amountPaise).toBe(16_500_000);
    const days = Math.round(
      (new Date(j.entitlement.expiresAt).getTime() - Date.now()) / 86_400_000,
    );
    expect(days).toBe(90);
  });

  it("client-supplied days/amountPaise are ignored, not honoured", async () => {
    const { POST } = await import("@/app/api/acquisition/entitlement/activate/route");
    const r = await POST(
      req(
        { leaseType: "LEASE_30", days: 365, amountPaise: 1, expiresAt: "2999-01-01T00:00:00.000Z" },
        OP,
      ),
    );
    expect(r.status).toBe(200);
    const j: any = await r.json();
    // Not 365 days, not the year-2999 expiry the caller asked for.
    const days = Math.round(
      (new Date(j.entitlement.expiresAt).getTime() - Date.now()) / 86_400_000,
    );
    expect(days).toBe(30);
    expect(mem.acquisitionOrder[0]!.amountPaise).toBe(6_000_000);
  });

  it("invalid leaseType → 400; bad JSON → 400", async () => {
    const { POST } = await import("@/app/api/acquisition/entitlement/activate/route");
    expect((await POST(req({ leaseType: "TRIAL_2D" }, OP))).status).toBe(400);
    expect((await POST(req({ days: 30 }, OP))).status).toBe(400);
    expect((await POST(req("not-json" as any, OP))).status).toBe(400);
  });

  it("fails closed when the operator key is unset", async () => {
    delete process.env.ACQUISITION_GRANT_KEY;
    const { POST } = await import("@/app/api/acquisition/entitlement/activate/route");
    expect((await POST(req({ leaseType: "LEASE_30" }, OP))).status).toBe(403);
  });
});

describe("POST transition", () => {
  beforeEach(() => {
    process.env.ACQUISITION_GRANT_KEY = "test-operator-key";
  });
  afterEachRoute(() => {
    delete process.env.ACQUISITION_GRANT_KEY;
  });

  async function seedEntitlement() {
    const { POST: activate } = await import("@/app/api/acquisition/entitlement/activate/route");
    await activate(
      req({ leaseType: "LEASE_30" }, { "x-acquisition-grant-key": "test-operator-key" }),
    );
  }

  it("invalid action → 400; suspend/resume round-trip; bad resume → 400", async () => {
    const { POST } = await import("@/app/api/acquisition/entitlement/transition/route");
    expect((await POST(req({ action: "explode" }))).status).toBe(400);
    await seedEntitlement();
    expect((await POST(req({ action: "suspend" }))).status).toBe(200);
    const resumed = await POST(req({ action: "resume" }));
    expect(resumed.status).toBe(200);
    expect(((await resumed.json()) as any).entitlement.status).toBe("active");
    const bad = await POST(req({ action: "resume" }));
    expect(bad.status).toBe(400);
  });

  it("renew is operator-only and takes its duration from the price table", async () => {
    const { POST } = await import("@/app/api/acquisition/entitlement/transition/route");
    await seedEntitlement();
    const before = new Date(mem.acquisitionEntitlement[0]!.expiresAt).getTime();
    // Owner, no operator key: refused, and the expiry is untouched.
    const denied = await POST(req({ action: "renew", days: 365, expiresAt: "2999-01-01T00:00:00.000Z" }));
    expect(denied.status).toBe(403);
    expect(new Date(mem.acquisitionEntitlement[0]!.expiresAt).getTime()).toBe(before);

    // Operator with a leaseType: the extension is server-derived.
    const ok = await POST(
      req({ action: "renew", leaseType: "LEASE_90", days: 365 }, { "x-acquisition-grant-key": "test-operator-key" }),
    );
    expect(ok.status).toBe(200);
    const added = Math.round(
      (new Date(mem.acquisitionEntitlement[0]!.expiresAt).getTime() - before) / 86_400_000,
    );
    // 90 days from the existing expiry — not the 365 the body asked for.
    expect(added).toBe(90);
  });

  it("refund is operator-only", async () => {
    const { POST } = await import("@/app/api/acquisition/entitlement/transition/route");
    await seedEntitlement();
    expect((await POST(req({ action: "refund" }))).status).toBe(403);
    const ok = await POST(
      req({ action: "refund", reason: "customer request" }, { "x-acquisition-grant-key": "test-operator-key" }),
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).entitlement.status).toBe("refunded");
  });
});

describe("conversions route", () => {
  it("GET lists; POST member 403; POST CLICKED 400; POST WON 200 + cancels follow-ups", async () => {
    const mod = await import("@/app/api/acquisition/conversions/route");
    mem.followUp.push({ id: "fu1", tenantId: "t1", leadKey: "apex", status: "pending", business: "Apex" });
    sessionRole = "member";
    expect((await mod.POST(req({ leadKey: "apex", state: "WON" }))).status).toBe(403);
    sessionRole = "owner";
    expect((await mod.POST(req({ leadKey: "apex", state: "CLICKED" }))).status).toBe(400);
    const r = await mod.POST(req({ leadKey: "apex", state: "WON", businessName: "Apex" }));
    expect(r.status).toBe(200);
    expect((((await r.json()) as any).followUpsCancelled)).toBe(1);
    expect((await mod.GET()).status).toBe(200);
  });
});

describe("ingest route", () => {
  it("missing tenantId 400; no auth 401; bad key 401; key mode ok 200; replay dedupes", async () => {
    const { POST } = await import("@/app/api/acquisition/replies/ingest/route");
    const { auth } = await import("@/lib/auth");
    expect((await POST(req({ kind: "reply", body: "hi" }))).status).toBe(400);
    vi.mocked(auth as unknown as { mockResolvedValueOnce(v: null): void }).mockResolvedValueOnce(null);
    expect((await POST(req({ tenantId: "t1", kind: "reply", body: "hi" }))).status).toBe(401);
    process.env.ACQUISITION_INGEST_KEY = "k1";
    expect((await POST(req({ tenantId: "t1", kind: "reply", body: "hi" }, { "x-ingest-key": "wrong" }))).status).toBe(401);
    mem.leadResearch.push({ tenantId: "t1", leadKey: "apex", business: "Apex", email: "o@e.example" });
    const r1 = await POST(req({ tenantId: "t1", leadKey: "apex", kind: "reply", body: "Interested!", providerMsgId: "m1" }, { "x-ingest-key": "k1" }));
    expect(r1.status).toBe(200);
    expect((((await r1.json()) as any).status)).toBe("POSITIVE");
    const r2 = await POST(req({ tenantId: "t1", leadKey: "apex", kind: "reply", body: "Interested!", providerMsgId: "m1" }, { "x-ingest-key": "k1" }));
    expect((((await r2.json()) as any).deduped)).toBe(true);
    expect((await POST(req({ tenantId: "t1", kind: "reply", body: "x".repeat(5000) }, { "x-ingest-key": "k1" }))).status).toBe(400);
  });
});

describe("cron scheduler", () => {
  it("no secret → 503; wrong → 401; right → 200 with sweep summary", async () => {
    const { GET } = await import("@/app/api/cron/reconcile/route");
    const call = (bearer?: string) => GET(new Request("http://test/api/cron/reconcile", { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }));
    expect((await call()).status).toBe(503);
    process.env.CRON_SECRET = "s3";
    expect((await call("nope")).status).toBe(401);
    const r = await call("s3");
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.ok).toBe(true);
    expect(j.expiry).toMatchObject({ checked: 0, expired: 0 });
    expect(j.tenants).toBe(0);
  });
});

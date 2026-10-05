/**
 * Chaos / failure-injection tests: kill each dependency, verify the system
 * detects, records, communicates, never corrupts, and can recover.
 * Synthetic tenants only. No network (fetch stubbed).
 *
 * Mocking note: a single static @wavesco/db factory driven by a hoisted
 * mutable scenario switch. (Sequential doMock + re-import does NOT rebind
 * already-loaded modules under vitest, so per-test doMock is unreliable.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbScenario = vi.hoisted(() => ({ mode: "throw" as "throw" | "expired-row" | "ai-enabled" | "cron-empty" | "cron-throw" }));
const aiUsageCreate = vi.hoisted(() => vi.fn(async () => ({ id: "u1" })));
const authSession = vi.hoisted(() => ({ value: null as any }));

vi.mock("@wavesco/db", () => ({
  withTenantContext: async (_tid: string, fn: any) => {
    if (dbScenario.mode === "throw") throw new Error("connection refused");
    if (dbScenario.mode === "ai-enabled") {
      return fn({
        clientAiConfig: {
          findFirst: async () => ({
            aiEnabled: true, provider: "ollama_cloud", model: "gemma4:31b",
            baseUrl: "https://ollama.example/v1", credentialRef: "env:OPENAI_API_KEY",
          }),
        },
        aiUsageLog: { create: aiUsageCreate },
      });
    }
    return fn({
      acquisitionEntitlement: {
        findUnique: async () => ({
          id: "ent1", status: "ACTIVE",
          trialStartedAt: null, trialExpiresAt: null,
          startedAt: new Date(Date.now() - 40 * 86_400_000),
          expiresAt: new Date(Date.now() - 1000),
        }),
        update: async ({ data }: any) => ({ id: "ent1", status: "ACTIVE", ...data }),
      },
    });
  },
  directPrisma: () => ({
    tenant: {
      findFirst: async () => ({ id: "t1", slug: "s" }),
      findMany: async () => {
        if (dbScenario.mode === "cron-throw") throw new Error("db blip");
        return [];
      },
    },
    acquisitionEntitlement: { findMany: async () => [] },
  }),
  prisma: {
    tenant: {
      findFirst: async () => ({ id: "t1", slug: "s" }),
      findMany: async () => {
        if (dbScenario.mode === "cron-throw") throw new Error("db blip");
        return [];
      },
    },
    acquisitionEntitlement: { findMany: async () => [] },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => authSession.value) }));
vi.mock("@/lib/wavesco/lead-engine", () => ({
  openReadonly: () => { throw new Error("no engine"); },
  updateLeadOutreachState: async () => ({}),
}));

import { requireAcquisitionAccess, entitlementDeniedPayload } from "@/lib/wavesco/entitlements";

const OLD_ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  dbScenario.mode = "throw";
  authSession.value = null;
  aiUsageCreate.mockClear();
  aiUsageCreate.mockResolvedValue({ id: "u1" } as any);
});
afterEach(() => { process.env = { ...OLD_ENV }; vi.unstubAllGlobals(); });

describe("chaos — total DB outage fails closed (never fake-open)", () => {
  it("entitlement gate denies when the database is unreachable", async () => {
    dbScenario.mode = "throw";
    try {
      await requireAcquisitionAccess("t1");
      expect.unreachable("must deny");
    } catch (e: any) {
      expect(e.message).toMatch(/^ENTITLEMENT_REQUIRED/);
      const payload = entitlementDeniedPayload(e)!;
      expect(payload.status).toBe(403);
      expect(payload.body.whatNext).toMatch(/trial|renew|Billing/i);
    }
  });
});

describe("chaos — expired grant mid-flow", () => {
  it("denies with 402 + reason + renewal path (never silent, never 500)", async () => {
    dbScenario.mode = "expired-row";
    try {
      await requireAcquisitionAccess("t1");
      expect.unreachable("must deny");
    } catch (e: any) {
      expect(e.status).toBe(402);
      const payload = entitlementDeniedPayload(e)!;
      expect(payload.body).toMatchObject({ error: "entitlement_required", status: "expired" });
      expect(String(payload.body.whatNext)).toMatch(/renew/i);
    }
  });
});

describe("chaos — AI provider failures degrade loudly, never fake success", () => {
  beforeEach(() => {
    process.env.LEAD_ENGINE_GATEWAY_TOKEN = "tok";
    process.env.WAVESCO_ENGINE_TENANT = "t1";
    process.env.OPENAI_API_KEY = "k";
    dbScenario.mode = "ai-enabled";
  });

  async function post() {
    const { POST } = await import("@/app/api/ai/gateway/route");
    return POST(new Request("http://t/api/ai/gateway", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer tok" },
      body: JSON.stringify({ operation: "enrich", system: "s", prompt: "p" }),
    }) as any);
  }

  it("provider HTTP 500 → 502 provider_error + error ledger write", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })));
    const res = await post();
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).status).toBe("provider_error");
    expect(aiUsageCreate).toHaveBeenCalled();
    const firstCall = aiUsageCreate.mock.calls[0] as any;
    expect(firstCall[0].data.status).toBe("error");
  });

  it("provider timeout → 502 (bounded by AbortSignal, no hang)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: any, opts: any) => {
      expect(opts?.signal).toBeDefined();
      const err: any = new Error("The operation was aborted");
      err.name = "TimeoutError";
      throw err;
    }));
    const res = await post();
    expect(res.status).toBe(502);
  });

  it("malformed provider JSON → 502, never a fabricated completion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ garbage: true }) })));
    const res = await post();
    expect(res.status).toBe(502);
    const j: any = await res.json();
    expect(j.ok).toBe(false);
    expect(j.text ?? null).toBeNull();
  });
});

describe("chaos — scheduler auth and degraded tenant listing", () => {
  it("reconcile route without key configured → 503 (disabled, not open)", async () => {
    delete process.env.ACQUISITION_RECONCILE_KEY;
    const { POST } = await import("@/app/api/acquisition/reconcile/route");
    const res = await POST(new Request("http://t/api", {
      method: "POST",
      headers: { "x-reconcile-key": "anything" },
    }));
    expect(res.status).toBe(503);
  });

  it("cron recovers per-tenant: tenant-list failure → 200 warning (not 500)", async () => {
    process.env.CRON_SECRET = "s3";
    dbScenario.mode = "cron-throw";
    const { GET } = await import("@/app/api/cron/reconcile/route");
    const res = await GET(new Request("http://t/api/cron/reconcile", { headers: { authorization: "Bearer s3" } }));
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.expiry).toMatchObject({ checked: 0, expired: 0 });
    expect(j.warning).toMatch(/Tenant list failed/);
  });

  it("cron without secret → 503; wrong secret → 401", async () => {
    dbScenario.mode = "cron-empty";
    const { GET } = await import("@/app/api/cron/reconcile/route");
    const call = (bearer?: string) => GET(new Request("http://t/api/cron/reconcile", { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }));
    expect((await call()).status).toBe(503);
    process.env.CRON_SECRET = "s3";
    expect((await call("nope")).status).toBe(401);
    const ok = await call("s3");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).tenants).toBe(0);
  });
});

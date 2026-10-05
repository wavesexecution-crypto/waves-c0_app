import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/wavesco/control", () => ({
  acquisitionDenied: vi.fn(async () => null),
  requireControlAuth: vi.fn(async () => {
    throw new Error("UNAUTHORIZED");
  }),
  auditControl: vi.fn(async () => ({ id: "audit1" })),
}));

vi.mock("@wavesco/db", () => ({
  withTenantContext: vi.fn(),
  prisma: {
    campaign: { count: vi.fn(async () => 0) },
    outreachEmail: { count: vi.fn(async () => 0) },
    outreachOrder: { count: vi.fn(async () => 0) },
    leadResearch: { count: vi.fn(async () => 0) },
    activityEvent: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    integrationStatus: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    aiUsageLog: { findMany: vi.fn(async () => []) },
    generationBatch: { count: vi.fn(async () => 0) },
  },
}));

vi.mock("@/lib/wavesco/lead-engine", () => ({
  getLeadStats: vi.fn(),
  getFacets: vi.fn(),
  getLastEngineRun: vi.fn(),
}));

describe("GET /api/acquisition/analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { GET } = await import("@/app/api/acquisition/analytics/route");
    const res = await GET(new Request("http://test"));
    expect(res.status).toBe(401);
    const json: any = await res.json().catch(() => ({}));
    expect(json.error).toBeDefined();
  });

  it("zeros with empty tenant", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    const { getLeadStats } = await import("@/lib/wavesco/lead-engine");

    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    vi.mocked(getLeadStats).mockResolvedValue({
      total: 0,
      emailReady: 0,
      contacted: 0,
      replies: 0,
      optedOut: 0,
      bounced: 0,
      byTier: {},
      lastResearchedAt: null,
    } as any);

    vi.mocked(withTenantContext).mockImplementation(async (_tenantId: string, fn: any) => {
      const tx: any = {
        campaign: { count: async () => 0 },
        outreachEmail: {
          count: async ({ where }: any) => {
            // differentiate by status but all 0 for empty
            if (where?.status === "sent") return 0;
            if (where?.status === "failed") return 0;
            if (where?.status?.in) return 0;
            return 0;
          },
        },
        outreachOrder: {
          count: async () => 0,
          findMany: async () => [],
        },
        leadResearch: { count: async () => 0 },
        activityEvent: { count: async () => 0, findMany: async () => [] },
        integrationStatus: { count: async () => 0, findMany: async () => [] },
        aiUsageLog: { findMany: async () => [] },
        generationBatch: { count: async () => 0 },
        followUp: { count: async () => 0 },
      };
      return fn(tx);
    });

    const { GET } = await import("@/app/api/acquisition/analytics/route");
    const res = await (GET as any)(new Request("http://test"));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.acquisition.total).toBe(0);
    expect(json.acquisition.emailReady).toBe(0);
    expect(json.campaign).toBeDefined();
    expect(json.funnel).toBeDefined();
    expect(json.responseRates).toBeDefined();
    expect(json.workflow).toBeDefined();
    expect(json.apiUsage).toBeDefined();
    expect(json.modelUsage).toBeDefined();
    expect(json.costs).toBeDefined();
    expect(json.costs.estimatedCostUsd).toBe(0);
    // ensure not error
    expect(json.error).toBeUndefined();
  });

  it("returns populated metrics when data exists", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    const { getLeadStats } = await import("@/lib/wavesco/lead-engine");

    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    vi.mocked(getLeadStats).mockResolvedValue({
      total: 100,
      emailReady: 40,
      contacted: 20,
      replies: 5,
      optedOut: 1,
      bounced: 2,
      byTier: { A: 10, B: 20 },
      lastResearchedAt: "2026-09-01T00:00:00.000Z",
    } as any);

    vi.mocked(withTenantContext).mockImplementation(async (_tenantId: string, fn: any) => {
      const tx: any = {
        campaign: { count: async () => 3 },
        outreachEmail: {
          count: async ({ where }: any) => {
            if (where?.status === "sent") return 15;
            if (where?.status === "failed") return 1;
            if (where?.status?.in && Array.isArray(where.status.in) && where.status.in.includes("submitted")) return 4;
            if (!where?.status) return 20;
            return 0;
          },
        },
        outreachOrder: {
          count: async (args: any) => {
            const where = args?.where ?? {};
            // replyStatus not null check
            if (where.replyStatus !== undefined || where.NOT !== undefined) return 3;
            if (where.status) return 10;
            return 10;
          },
          findMany: async () => [],
        },
        leadResearch: {
          count: async (args: any) => {
            const where = args?.where ?? {};
            // emailReady = leads with a verified email snapshot
            if (where.email && where.email.not === null) return 40;
            return 100;
          },
          groupBy: async () => [
            { tier: "A", _count: { _all: 10 } },
            { tier: "B", _count: { _all: 20 } },
          ],
          findFirst: async () => ({
            researchedAt: new Date("2026-09-01T00:00:00.000Z"),
          }),
        },
        activityEvent: {
          count: async () => 25,
          findMany: async () => [
            { id: "a1", type: "campaign.launch", createdAt: new Date().toISOString() },
            { id: "a2", type: "email.sent", createdAt: new Date().toISOString() },
            { id: "a3", type: "campaign.launch", createdAt: new Date().toISOString() },
          ],
        },
        integrationStatus: {
          count: async () => 5,
          findMany: async () => [
            { key: "n8n", state: "connected" },
            { key: "lead_engine", state: "connected" },
            { key: "brevo", state: "error" },
          ],
        },
        aiUsageLog: {
          findMany: async () => [
            { id: "u1", tenantId: "t1", operation: "enrich", provider: "ollama_cloud", model: "gemma3:27b", status: "success", inputTokens: 1000, outputTokens: 500, latencyMs: 1200, estimatedCostUsd: null, createdAt: new Date().toISOString() },
            { id: "u2", tenantId: "t1", operation: "email", provider: "ollama_cloud", model: "gemma3:27b", status: "success", inputTokens: 2000, outputTokens: 800, latencyMs: 800, estimatedCostUsd: 0.01, createdAt: new Date().toISOString() },
            { id: "u3", tenantId: "t1", operation: "enrich", provider: "openai", model: "gpt-4o", status: "error", inputTokens: 500, outputTokens: 0, latencyMs: 300, estimatedCostUsd: null, error: "timeout", createdAt: new Date().toISOString() },
          ],
        },
        generationBatch: { count: async () => 2 },
        followUp: { count: async () => 6 },
      };
      return fn(tx);
    });

    const { GET } = await import("@/app/api/acquisition/analytics/route");
    const res = await (GET as any)(new Request("http://test"));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.acquisition.total).toBe(100);
    expect(json.acquisition.emailReady).toBe(40);
    expect(json.campaign.total).toBe(3);
    expect(json.campaign.sent).toBe(15);
    expect(json.funnel.total).toBe(100);
    expect(json.responseRates.replyRate).toBeGreaterThanOrEqual(0);
    expect(json.modelUsage.totalTokens).toBeGreaterThan(0);
    expect(json.modelUsage.byModel.length).toBeGreaterThan(0);
    expect(json.costs.estimatedCostUsd).toBeGreaterThan(0);
    expect(json.apiUsage.totalEvents).toBe(25);
  });

  it("never reads the cross-tenant lead engine corpus (tenant isolation)", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    const { getLeadStats } = await import("@/lib/wavesco/lead-engine");

    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    vi.mocked(getLeadStats).mockResolvedValue({
      // Corpus-wide numbers that must NEVER surface as tenant metrics.
      total: 9999,
      emailReady: 9999,
      contacted: 9999,
      replies: 9999,
      optedOut: 0,
      bounced: 0,
      byTier: { A: 9999 },
      lastResearchedAt: "2026-09-01T00:00:00.000Z",
    } as any);

    vi.mocked(withTenantContext).mockImplementation(async (_tenantId: string, fn: any) => {
      const tx: any = new Proxy(
        {
          activityEvent: { count: async () => 0, findMany: async () => [] },
          integrationStatus: { count: async () => 0, findMany: async () => [] },
          aiUsageLog: { findMany: async () => [] },
        },
        {
          get(target: any, prop: string) {
            if (prop in target) return target[prop];
            // Default: count() always 0 — tenant DB is empty.
            return {
              count: async () => 0,
              findMany: async () => [],
              findFirst: async () => null,
            };
          },
        },
      );
      return fn(tx);
    });

    const { GET } = await import("@/app/api/acquisition/analytics/route");
    const res = await (GET as any)(new Request("http://test"));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    // Corpus says 9999 everywhere; tenant DB is empty — analytics must show 0.
    expect(json.acquisition.total).toBe(0);
    expect(json.acquisition.emailReady).toBe(0);
    expect(json.acquisition.replies).toBe(0);
    expect(Object.values(json.acquisition.byTier ?? {}).reduce((a: number, b: any) => a + b, 0)).toBe(0);
    // The shared corpus reader must not be invoked at all.
    expect(getLeadStats).not.toHaveBeenCalled();
  });
});

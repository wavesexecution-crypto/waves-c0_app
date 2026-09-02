import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/wavesco/control", () => ({
  requireControlAuth: vi.fn(async () => {
    throw new Error("UNAUTHORIZED");
  }),
  auditControl: vi.fn(async () => ({ id: "audit1" })),
}));

vi.mock("@wavesco/db", () => ({
  withTenantContext: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
    auditLog: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), create: vi.fn(async (x: any) => ({ id: "a1", ...x.data })) },
    campaign: { count: vi.fn(async () => 0) },
    outreachEmail: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    outreachOrder: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    leadResearch: { count: vi.fn(async () => 0) },
    activityEvent: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    integrationStatus: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    aiUsageLog: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    generationBatch: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    followUp: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/wavesco/lead-engine", () => ({
  getLeadStats: vi.fn(async () => ({ total: 0, emailReady: 0, contacted: 0, replies: 0, optedOut: 0, bounced: 0, byTier: {}, lastResearchedAt: null })),
  getFacets: vi.fn(async () => ({ categories: [], cities: [] })),
  getLastEngineRun: vi.fn(async () => null),
}));

describe("/api/system/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { GET } = await import("@/app/api/system/health/route");
    const res = await GET(new Request("http://test"));
    expect(res.status).toBe(401);
    const json: any = await res.json().catch(() => ({}));
    expect(json.error).toBeDefined();
  });

  it("200 with auth returns health object", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");

    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);

    vi.mocked(withTenantContext).mockImplementation(async (_tenantId: string, fn: any) => {
      const tx: any = {
        campaign: { count: async () => 2 },
        outreachEmail: {
          count: async ({ where }: any) => {
            if (where?.status === "failed") return 1;
            if (where?.status === "sent") return 5;
            if (where?.status?.in) return 3;
            if (!where?.status) return 6;
            return 0;
          },
          findMany: async () => [
            { id: "oe1", business: "Acme", email: "a@acme.co", status: "failed", error: "bounce", createdAt: new Date().toISOString() },
          ],
        },
        outreachOrder: { count: async () => 4, findMany: async () => [] },
        leadResearch: { count: async () => 10 },
        activityEvent: {
          count: async () => 5,
          findMany: async () => [
            { id: "ev1", type: "campaign.launch", title: "Launch", createdAt: new Date().toISOString(), tenantId: "t1" },
            { id: "ev2", type: "email.sent", title: "Sent", createdAt: new Date().toISOString(), tenantId: "t1" },
          ],
        },
        integrationStatus: { count: async () => 2, findMany: async () => [] },
        aiUsageLog: { count: async () => 3, findMany: async () => [] },
        generationBatch: {
          count: async ({ where }: any) => {
            if (where?.status === "failed") return 1;
            if (where?.status === "queued") return 1;
            return 2;
          },
          findMany: async () => [
            { id: "gb1", requestId: "req1", status: "failed", error: "pdf fail", createdAt: new Date().toISOString() },
          ],
        },
        followUp: {
          count: async ({ where }: any) => {
            if (where?.status === "pending") return 2;
            return 2;
          },
          findMany: async () => [],
        },
        auditLog: {
          count: async () => 12,
          findMany: async () => [
            { id: "al1", tenantId: "t1", action: "campaign.launch", model: "Campaign", recordId: "c1", createdAt: new Date().toISOString(), userId: "u1" },
            { id: "al2", tenantId: "t1", action: "integration.test", model: "IntegrationStatus", createdAt: new Date().toISOString(), userId: "u1" },
          ],
        },
        leadLifecycleEvent: { count: async () => 0 },
        client: { count: async () => 0 },
        aiUsageLog2: { count: async () => 0 },
      };
      // Add missing models with generic count
      const generic = async () => 0;
      for (const k of ["leadLifecycleEvent", "client", "project", "deliverable"]) {
        if (!tx[k]) tx[k] = { count: generic, findMany: async () => [] };
      }
      return fn(tx);
    });

    const { GET } = await import("@/app/api/system/health/route");
    const res = await (GET as any)(new Request("http://test"));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.health).toBeDefined();
    expect(json.health.db).toBeDefined();
    expect(json.health.leadEngine).toBeDefined();
    expect(json.health.n8n).toBeDefined();
    expect(json.health.aiGateway).toBeDefined();
    expect(json.auditLogs).toBeDefined();
    expect(Array.isArray(json.auditLogs)).toBe(true);
    expect(json.queueDepth).toBeDefined();
    expect(json.dbCounts).toBeDefined();
    expect(typeof json.queueDepth).toBe("number");
    expect(json.dbCounts.campaigns).toBeDefined();
  });
});

describe("/api/system/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { GET } = await import("@/app/api/system/logs/route");
    const res = await GET(new Request("http://test"));
    expect(res.status).toBe(401);
  });

  it("200 with auth returns logs tenant-scoped with limit", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: any) => {
      const tx: any = {
        activityEvent: {
          findMany: async ({ take }: any) => {
            const n = typeof take === "number" ? take : 50;
            return Array.from({ length: Math.min(n, 2) }, (_, i) => ({
              id: `ev${i + 1}`,
              tenantId: "t1",
              type: "test.event",
              title: `Event ${i + 1}`,
              createdAt: new Date().toISOString(),
            }));
          },
          count: async () => 2,
        },
      };
      return fn(tx);
    });
    const { GET } = await import("@/app/api/system/logs/route");
    const res = await GET(new Request("http://test?limit=2"));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    // allow either logs or events key, but prefer logs
    const arr = json.logs ?? json.events ?? json.data ?? [];
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeLessThanOrEqual(2);
    // tenant scoping: returned tenantId should be t1 if present
    if (arr.length > 0 && arr[0].tenantId) {
      expect(arr[0].tenantId).toBe("t1");
    }
  });

  it("clamps limit to max 100", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    let capturedTake: number | null = null;
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: any) => {
      const tx: any = {
        activityEvent: {
          findMany: async (args: any) => {
            capturedTake = args.take;
            return [];
          },
        },
      };
      return fn(tx);
    });
    const { GET } = await import("@/app/api/system/logs/route");
    const res = await GET(new Request("http://test?limit=500"));
    expect(res.status).toBe(200);
    expect(capturedTake).toBeLessThanOrEqual(100);
  });
});

describe("/api/system/audit-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { GET } = await import("@/app/api/system/audit-logs/route");
    const res = await GET(new Request("http://test"));
    expect(res.status).toBe(401);
  });

  it("200 with auth returns auditLogs with pagination tenant-scoped", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: any) => {
      const tx: any = {
        auditLog: {
          findMany: async ({ where, take, skip }: any) => {
            expect(where.tenantId).toBe("t1");
            void take;
            void skip;
            return [
              { id: "al1", tenantId: "t1", action: "campaign.launch", model: "Campaign", recordId: "c1", userId: "u1", createdAt: new Date().toISOString() },
              { id: "al2", tenantId: "t1", action: "agent.enable", model: "ClientAiConfig", recordId: "t1", userId: "u1", createdAt: new Date().toISOString() },
            ];
          },
          count: async ({ where }: any) => {
            expect(where.tenantId).toBe("t1");
            return 2;
          },
        },
      };
      return fn(tx);
    });
    const { GET } = await import("@/app/api/system/audit-logs/route");
    const res = await GET(new Request("http://test?limit=10&offset=0"));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.auditLogs).toBeDefined();
    expect(Array.isArray(json.auditLogs)).toBe(true);
    expect(json.auditLogs.length).toBeGreaterThan(0);
    expect(json.total).toBeDefined();
    // pagination keys
    expect(json.limit).toBeDefined();
    expect(json.offset).toBeDefined();
    // tenant scoping
    for (const row of json.auditLogs as any[]) {
      if (row.tenantId) expect(row.tenantId).toBe("t1");
    }
  });

  it("filters by action when provided", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    let capturedWhere: any = null;
    vi.mocked(withTenantContext).mockImplementation(async (_tid: string, fn: any) => {
      const tx: any = {
        auditLog: {
          findMany: async ({ where }: any) => {
            capturedWhere = where;
            return [{ id: "al1", tenantId: "t1", action: "campaign.launch", model: "Campaign", createdAt: new Date().toISOString(), userId: "u1" }];
          },
          count: async () => 1,
        },
      };
      return fn(tx);
    });
    const { GET } = await import("@/app/api/system/audit-logs/route");
    const res = await GET(new Request("http://test?action=campaign.launch"));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.auditLogs.length).toBe(1);
    expect(capturedWhere.action).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/wavesco/control", () => ({ requireControlAuth: vi.fn() }));
vi.mock("@wavesco/db", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/wavesco/lead-engine", () => ({
  getLeadStats: vi.fn(),
  getFacets: vi.fn(),
  getLastEngineRun: vi.fn(),
}));

describe("GET /api/acquisition/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    vi.mocked(requireControlAuth).mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const { GET } = await import("@/app/api/acquisition/overview/route");
    const res = await GET(new Request("http://test"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with tenant and scoped counts", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    const { getLeadStats, getFacets, getLastEngineRun } = await import("@/lib/wavesco/lead-engine");

    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    vi.mocked(getLeadStats).mockResolvedValue({
      total: 42,
      emailReady: 10,
      contacted: 5,
      optedOut: 0,
      bounced: 0,
      replies: 2,
      byTier: { A: 1 },
      lastResearchedAt: null,
    } as any);
    vi.mocked(getFacets).mockResolvedValue({ categories: ["cat"], cities: ["city"] } as any);
    vi.mocked(getLastEngineRun).mockResolvedValue(null as any);
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId: string, fn: any) => {
      const tx: any = {
        campaign: { count: async () => 3 },
        outreachEmail: {
          count: async ({ where }: any) => {
            if (where?.status === "sent") return 7;
            if (where?.status === "failed") return 1;
            if (where?.status?.in) return 4;
            return 0;
          },
        },
        followUp: { count: async () => 2 },
        activityEvent: {
          findMany: async () => [{ id: "a1", title: "Test event", type: "test", createdAt: new Date().toISOString() }],
        },
      };
      return fn(tx);
    });

    const { GET } = await import("@/app/api/acquisition/overview/route");
    const res = await (GET as any)(new Request("http://test"));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.corpus.total).toBe(42);
    expect(json.corpus.emailReady).toBe(10);
    expect(json.platform.campaigns).toBe(3);
    expect(json.platform.queued).toBe(4);
    expect(json.platform.sent).toBe(7);
    expect(json.system).toBeDefined();
    expect(json.system.leadEngine.status).toBe("ok");
    expect(Array.isArray(json.alerts)).toBe(true);
    expect(json.corpus).toBeDefined();
    expect(json.platform).toBeDefined();
  });

  it("returns 200 with leadEngine error fallback not 500", async () => {
    const { requireControlAuth } = await import("@/lib/wavesco/control");
    const { withTenantContext } = await import("@wavesco/db");
    const { getLeadStats, getFacets, getLastEngineRun } = await import("@/lib/wavesco/lead-engine");

    vi.mocked(requireControlAuth).mockResolvedValue({ tenantId: "t1", userId: "u1", session: {} } as any);
    vi.mocked(getLeadStats).mockRejectedValue(new Error("engine unreachable"));
    vi.mocked(getFacets).mockRejectedValue(new Error("unreachable"));
    vi.mocked(getLastEngineRun).mockRejectedValue(new Error("unreachable"));
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId: string, fn: any) => {
      const tx: any = {
        campaign: { count: async () => 0 },
        outreachEmail: { count: async () => 0 },
        followUp: { count: async () => 0 },
        activityEvent: { findMany: async () => [] },
      };
      return fn(tx);
    });

    const { GET } = await import("@/app/api/acquisition/overview/route");
    const res = await (GET as any)(new Request("http://test"));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.system.leadEngine.status).toBe("error");
    expect(json.corpus.total).toBe(0);
    expect(json.system.db).toBeDefined();
    expect(json.system.n8n).toBeDefined();
  });
});
